use chrono::Utc;
use crate::{accounting_core::JournalEntry, sales_core::{post_sale, InventoryState, SaleLine}, AppDb, SaleInput};
use tauri::State;
use turso::{params, Connection};
use uuid::Uuid;

fn debit_account_for_payment_method(payment_method: &str) -> Result<&'static str, String> {
    match payment_method {
        "Cash" => Ok("1000-CASH"),
        "Bank" => Ok("1010-BANK"),
        "Mobile Money" => Ok("1020-MOBILE"),
        _ => Err("Invalid payment method".into()),
    }
}

async fn ensure_journal_schema(c: &Connection) -> Result<(), String> {
    c.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reversal_of TEXT
      );
      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_id TEXT NOT NULL REFERENCES journal_entries(id),
        account TEXT NOT NULL,
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries(reference);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines(journal_id);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account);
    "#).await.map_err(|e| e.to_string())
}

async fn persist_journal(c: &Connection, entry: &JournalEntry) -> Result<(), String> {
    c.execute(
        "INSERT INTO journal_entries(id,reference,event_type,description,posted_at,status,reversal_of) VALUES(?,?,?,?,?,?,?)",
        params![entry.id.clone(),entry.reference.clone(),format!("{:?}", entry.event_type),entry.description.clone(),entry.posted_at.clone(),format!("{:?}", entry.status),entry.reversal_of.clone()],
    ).await.map_err(|e| e.to_string())?;
    for line in &entry.lines {
        c.execute(
            "INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES(?,?,?,?)",
            params![entry.id.clone(), line.account.clone(), line.debit, line.credit],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Real application sales command. The UI contract remains `record_sale`.
/// All financial consequences are produced by Sales Core and persisted as a
/// balanced double-entry journal before the transaction is committed.
#[tauri::command]
pub async fn record_sale(state: State<'_, AppDb>, input: SaleInput) -> Result<String, String> {
    if input.items.is_empty() { return Err("Sale has no items".into()); }
    let payment_method = input.payment_method.trim();
    let debit_account = debit_account_for_payment_method(payment_method)?;
    let mut c = super::conn(&state).await?;
    let tx = c.transaction().await.map_err(|e| e.to_string())?;
    let reference = format!("SAL-{}", Uuid::new_v4().simple());
    let now = Utc::now().to_rfc3339();
    let lines: Vec<SaleLine> = input.items.iter().map(|item| SaleLine { sku: item.sku.clone(), qty: item.qty, unit_price: item.unit_price }).collect();

    let mut opening_inventory = Vec::with_capacity(lines.len());
    for line in &lines {
        let mut rows = tx.query("SELECT stock,cost FROM products WHERE sku=?1 AND active=1", params![line.sku.clone()]).await.map_err(|e| e.to_string())?;
        let row = rows.next().await.map_err(|e| e.to_string())?.ok_or_else(|| format!("Product not found: {}", line.sku))?;
        let qty: f64 = row.get(0).map_err(|e| e.to_string())?;
        let unit_cost: f64 = row.get(1).map_err(|e| e.to_string())?;
        drop(rows);
        opening_inventory.push((line.sku.clone(), InventoryState { qty, unit_cost }));
    }

    let posting = post_sale(reference.clone(), now.clone(), &lines, debit_account, "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening_inventory)?;
    ensure_journal_schema(&tx).await?;
    persist_journal(&tx, &posting.journal).await?;

    tx.execute("INSERT INTO sales(reference,sale_date,subtotal,revenue,cogs,profit,payment_method,status) VALUES(?,?,?,?,?,?,?,?)", params![reference.clone(),now.clone(),posting.total_revenue,posting.total_revenue,posting.total_cogs,posting.total_revenue-posting.total_cogs,payment_method,"POSTED"]).await.map_err(|e| e.to_string())?;
    let sale_id = tx.last_insert_rowid();

    for (line, (_, updated_inventory)) in lines.iter().zip(posting.inventory_after.iter()) {
        let opening = opening_inventory.iter().find(|(sku, _)| sku == &line.sku).map(|(_, state)| state.clone()).ok_or_else(|| format!("Inventory state missing for {}", line.sku))?;
        let line_revenue = line.total()?;
        let line_cogs = line.qty * opening.unit_cost;
        tx.execute("INSERT INTO sale_items(sale_id,sku,qty,unit_price,unit_cost,line_revenue,line_cogs,line_profit) VALUES(?,?,?,?,?,?,?,?)", params![sale_id,line.sku.clone(),line.qty,line.unit_price,opening.unit_cost,line_revenue,line_cogs,line_revenue-line_cogs]).await.map_err(|e| e.to_string())?;
        tx.execute("UPDATE products SET stock=?1,updated_at=?2 WHERE sku=?3", params![updated_inventory.qty,now.clone(),line.sku.clone()]).await.map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_out,balance_after,unit_cost,created_at) VALUES(?,?,?,?,?,?,?)", params![reference.clone(),line.sku.clone(),"SALE",line.qty,updated_inventory.qty,opening.unit_cost,now.clone()]).await.map_err(|e| e.to_string())?;
    }

    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)", params![reference.clone(),"SALE","POS sale",posting.total_revenue,payment_method,now.clone()]).await.map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO audit_log(actor,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)", params!["local-user","SALE_POSTED","SALE",reference.clone(),format!("journal_id={}",posting.journal.id),now]).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(reference)
}
