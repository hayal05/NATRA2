use crate::accounting_core::JournalEntry;
use chrono::Utc;
use turso::{params, Connection, Transaction};

pub async fn ensure_schema(c: &Connection) -> Result<(), String> {
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

fn validate_entry(entry: &JournalEntry) -> Result<(), String> {
    if !entry.is_balanced() { return Err("Cannot persist an unbalanced journal entry".into()); }
    if entry.reference.trim().is_empty() { return Err("Journal reference is required".into()); }
    Ok(())
}

pub async fn persist_journal(c: &Connection, entry: &JournalEntry) -> Result<(), String> {
    validate_entry(entry)?;
    insert_journal(c, entry).await
}

pub async fn persist_journal_tx(tx: &Transaction<'_>, entry: &JournalEntry) -> Result<(), String> {
    validate_entry(entry)?;
    // Transaction dereferences to its transaction-backed Connection. Explicitly
    // dereference it here so Rust does not attempt an incompatible lifetime coercion.
    insert_journal(&*tx, entry).await
}

async fn insert_journal(c: &Connection, entry: &JournalEntry) -> Result<(), String> {
    c.execute(
        "INSERT INTO journal_entries(id,reference,event_type,description,posted_at,status,reversal_of) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![entry.id.clone(), entry.reference.clone(), format!("{:?}", entry.event_type), entry.description.clone(), entry.posted_at.clone(), format!("{:?}", entry.status), entry.reversal_of.clone()],
    ).await.map_err(|e| e.to_string())?;

    for line in &entry.lines {
        c.execute(
            "INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES(?1,?2,?3,?4)",
            params![entry.id.clone(), line.account.clone(), line.debit, line.credit],
        ).await.map_err(|e| e.to_string())?;
    }

    c.execute(
        "INSERT INTO audit_log(actor,action,entity_type,entity_id,details,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params!["local-user", "JOURNAL_POSTED", "JOURNAL_ENTRY", entry.reference.clone(), format!("event={:?};debit={};credit={}", entry.event_type, entry.total_debit(), entry.total_credit()), Utc::now().to_rfc3339()],
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}
