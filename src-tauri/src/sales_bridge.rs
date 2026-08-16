use chrono::Utc;
use crate::{accounting_persistence, sales_core::{post_sale, InventoryState, SaleLine}, AppDb, SaleInput};
use std::collections::HashSet;
use tauri::State;
use turso::params;
use uuid::Uuid;

fn debit_account_for_payment_method(payment_method: &str) -> Result<&'static str, String> {
    match payment_method {
        "Cash" => Ok("1000-CASH"),
        "Bank" => Ok("1010-BANK"),
        "Mobile Money" => Ok("1020-MOBILE"),
        _ => Err("Invalid payment method".into()),
    }
}

#[tauri::command]
pub async fn record_sale(state: State<'_, AppDb>, input: SaleInput) -> Result<String, String> {
    if input.items.is_empty() { return Err("Sale has no items".into()); }
    let payment_method = input.payment_method.trim();
    let debit_account = debit_account_for_payment_method(payment_method)?;

    let mut seen = HashSet::new();
    for item in &input.items {
        let sku = item.sku.trim();
        if sku.is_empty() { return Err("SKU is required".into()); }
        if item.qty <= 0.0 || !item.qty.is_finite() { return Err(format!("Invalid quantity for {}", sku)); }
        if item.unit_price < 0.0 || !item.unit_price.is_finite() { return Err(format!("Invalid unit price for {}", sku)); }
        if !seen.insert(sku.to_string()) { return Err(format!("Duplicate SKU in sale: {}", sku)); }
    }

    let mut c = super::conn(&state).await?;
    let tx = c.transaction().await.map_err(|e| e.to_string())?;
    let reference = format!("SAL-{}", Uuid::new_v4().simple());
    let now = Utc::now().to_rfc3339();
    let lines: Vec<SaleLine> = input.items.iter().map(|item| SaleLine {
        sku: item.sku.trim().to_string(), qty: item.qty, unit_price: item.unit_price,
    }).collect();

    let mut opening_inventory = Vec::with_capacity(lines.len());
    for line in &lines {
        let mut rows = tx.query("SELECT stock,cost FROM products WHERE sku=?1 AND active=1", params![line.sku.clone()]).await.map_err(|e| e.to_string())?;
        let row = rows.next().await.map_err(|e| e.to_string())?.ok_or_else(|| format!("Product not found: {}", line.sku))?;
        let qty: f64 = row.get(0).map_err(|e| e.to_string())?;
        let unit_cost: f64 = row.get(1).map_err(|e| e.to_string())?;
        drop(rows);
        if line.qty > qty { return Err(format!("Insufficient stock for {}", line.sku)); }
        opening_inventory.push((line.sku.clone(), InventoryState { qty, unit_cost }));
    }

    let posting = post_sale(reference.clone(), now.clone(), &lines, debit_account, "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening_inventory)?;
    accounting_persistence::persist_journal_tx(&tx, &posting.journal).await?;

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
