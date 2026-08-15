use chrono::Utc;
use turso::transaction::Transaction;
use turso::{params, Connection};

/// Core double-entry accounting schema and posting primitives.
/// Existing business tables remain the operational source for now; subsequent
/// migrations will post each business event atomically into this ledger.
pub async fn ensure_schema(c: &Connection) -> Result<(), String> {
    c.execute_batch(r#"
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS chart_of_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
        normal_balance TEXT NOT NULL CHECK(normal_balance IN ('DEBIT','CREDIT')),
        parent_code TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        entry_date TEXT NOT NULL,
        description TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_reference TEXT,
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','VOID')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
        debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
        credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
        memo TEXT,
        CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
        UNIQUE(journal_entry_id, account_code, debit, credit, memo)
      );

      CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_reference);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

      CREATE TRIGGER IF NOT EXISTS trg_journal_entry_no_update
      BEFORE UPDATE ON journal_entries
      WHEN OLD.status = 'POSTED'
      BEGIN
        SELECT RAISE(ABORT, 'Posted journal entries are immutable');
      END;

      INSERT OR IGNORE INTO chart_of_accounts(code,name,account_type,normal_balance,created_at) VALUES
        ('1000','Cash','ASSET','DEBIT',datetime('now')),
        ('1010','Bank','ASSET','DEBIT',datetime('now')),
        ('1020','Mobile Money','ASSET','DEBIT',datetime('now')),
        ('1100','Accounts Receivable','ASSET','DEBIT',datetime('now')),
        ('1200','Inventory','ASSET','DEBIT',datetime('now')),
        ('2000','Accounts Payable','LIABILITY','CREDIT',datetime('now')),
        ('3000','Owner Equity','EQUITY','CREDIT',datetime('now')),
        ('4000','Sales Revenue','REVENUE','CREDIT',datetime('now')),
        ('4010','Sales Returns','REVENUE','DEBIT',datetime('now')),
        ('5000','Cost of Goods Sold','EXPENSE','DEBIT',datetime('now')),
        ('6000','Operating Expenses','EXPENSE','DEBIT',datetime('now')),
        ('6100','Inventory Adjustment Gain/Loss','EXPENSE','DEBIT',datetime('now')),
        ('6200','Tax Expense','EXPENSE','DEBIT',datetime('now'));
    "#).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn post(
    c: &Connection,
    reference: &str,
    entry_date: &str,
    description: &str,
    source_type: &str,
    source_reference: Option<&str>,
    lines: &[(&str, f64, f64, &str)],
) -> Result<(), String> {
    if lines.is_empty() { return Err("Journal entry must contain lines".into()); }
    let mut debit_total = 0.0;
    let mut credit_total = 0.0;
    for (_, debit, credit, _) in lines {
        if *debit < 0.0 || *credit < 0.0 || ((*debit > 0.0) == (*credit > 0.0)) {
            return Err("Each journal line must contain either debit or credit".into());
        }
        debit_total += *debit;
        credit_total += *credit;
    }
    if (debit_total - credit_total).abs() > 0.005 {
        return Err(format!("Unbalanced journal entry: debit {:.2}, credit {:.2}", debit_total, credit_total));
    }

    let tx = c.transaction().await.map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO journal_entries(reference,entry_date,description,source_type,source_reference,status,created_at) VALUES(?,?,?,?,?,'POSTED',?)",
        params![reference, entry_date, description, source_type, source_reference.unwrap_or(""), now.clone()],
    ).await.map_err(|e| e.to_string())?;
    let entry_id = tx.last_insert_rowid();
    for (account, debit, credit, memo) in lines {
        tx.execute(
            "INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?)",
            params![entry_id, account, *debit, *credit, *memo],
        ).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Transaction-scoped posting primitive for atomic business operations.
pub async fn post_in_transaction(
    tx: &Transaction<'_>,
    reference: &str,
    entry_date: &str,
    description: &str,
    source_type: &str,
    source_reference: Option<&str>,
    lines: &[(&str, f64, f64, &str)],
) -> Result<(), String> {
    if lines.is_empty() { return Err("Journal entry must contain lines".into()); }
    let mut debit_total = 0.0;
    let mut credit_total = 0.0;
    for (_, debit, credit, _) in lines {
        if *debit < 0.0 || *credit < 0.0 || ((*debit > 0.0) == (*credit > 0.0)) {
            return Err("Each journal line must contain either debit or credit".into());
        }
        debit_total += *debit;
        credit_total += *credit;
    }
    if (debit_total - credit_total).abs() > 0.005 {
        return Err(format!("Unbalanced journal entry: debit {:.2}, credit {:.2}", debit_total, credit_total));
    }
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO journal_entries(reference,entry_date,description,source_type,source_reference,status,created_at) VALUES(?,?,?,?,?,'POSTED',?)",
        params![reference, entry_date, description, source_type, source_reference.unwrap_or(""), now],
    ).await.map_err(|e| e.to_string())?;
    let entry_id = tx.last_insert_rowid();
    for (account, debit, credit, memo) in lines {
        tx.execute(
            "INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?)",
            params![entry_id, account, *debit, *credit, *memo],
        ).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
