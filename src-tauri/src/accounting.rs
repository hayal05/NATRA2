use chrono::Utc;
use turso::Connection;

/// A single journal line. Exactly one of debit/credit must be positive.
#[derive(Debug, Clone)]
pub struct JournalLine {
    pub account_code: String,
    pub debit: f64,
    pub credit: f64,
}

/// Create the accounting schema and the minimum chart of accounts.
pub async fn init_schema(c: &Connection) -> Result<(), String> {
    c.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('DRAFT','POSTED','VOID')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
        account_code TEXT NOT NULL REFERENCES accounts(code),
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        CHECK(debit >= 0 AND credit >= 0),
        CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
      );

      CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);
    "#).await.map_err(|e| e.to_string())?;

    let now = Utc::now().to_rfc3339();
    let defaults = [
        ("1000", "Cash", "ASSET"),
        ("1010", "Bank", "ASSET"),
        ("1020", "Mobile Money", "ASSET"),
        ("1100", "Accounts Receivable", "ASSET"),
        ("1200", "Inventory", "ASSET"),
        ("2000", "Accounts Payable", "LIABILITY"),
        ("3000", "Owner Equity", "EQUITY"),
        ("4000", "Sales Revenue", "REVENUE"),
        ("5000", "Cost of Goods Sold", "EXPENSE"),
        ("6000", "Operating Expenses", "EXPENSE"),
        ("7000", "Other Income", "REVENUE"),
    ];

    for (code, name, account_type) in defaults {
        c.execute(
            "INSERT OR IGNORE INTO accounts(code,name,account_type,created_at) VALUES(?1,?2,?3,?4)",
            turso::params![code, name, account_type, now.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // Existing expense transactions already write to cash_transactions inside the
    // same Turso transaction as the expense record. This trigger automatically creates
    // the matching double-entry journal without changing the UI or duplicating cash flow.
    c.execute_batch(r#"
      DROP TRIGGER IF EXISTS trg_expense_cash_to_journal;

      CREATE TRIGGER trg_expense_cash_to_journal
      AFTER INSERT ON cash_transactions
      WHEN NEW.tx_type = 'EXPENSE'
      BEGIN
        SELECT RAISE(ABORT, 'Unsupported expense cash account')
        WHERE NEW.account NOT IN ('Cash','Bank','Mobile Money');

        INSERT INTO journal_entries(reference,description,entry_date,status,created_at)
        VALUES(NEW.reference,'Operating expense',NEW.created_at,'POSTED',NEW.created_at);

        INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,created_at)
        SELECT id,'6000',NEW.amount,0,NEW.created_at
        FROM journal_entries WHERE reference=NEW.reference;

        INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,created_at)
        SELECT id,
               CASE NEW.account WHEN 'Cash' THEN '1000' WHEN 'Bank' THEN '1010' WHEN 'Mobile Money' THEN '1020' END,
               0,NEW.amount,NEW.created_at
        FROM journal_entries WHERE reference=NEW.reference;
      END;

      DROP TRIGGER IF EXISTS trg_refund_cash_to_journal;

      CREATE TRIGGER trg_refund_cash_to_journal
      AFTER INSERT ON cash_transactions
      WHEN NEW.tx_type = 'REFUND'
      BEGIN
        SELECT RAISE(ABORT, 'Unsupported refund cash account')
        WHERE NEW.account NOT IN ('Cash','Bank','Mobile Money');

        INSERT INTO journal_entries(reference,description,entry_date,status,created_at)
        VALUES(NEW.reference,'Customer sales refund',NEW.created_at,'POSTED',NEW.created_at);

        INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,created_at)
        SELECT id,'4000',NEW.amount,0,NEW.created_at
        FROM journal_entries WHERE reference=NEW.reference;

        INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,created_at)
        SELECT id,
               CASE NEW.account WHEN 'Cash' THEN '1000' WHEN 'Bank' THEN '1010' WHEN 'Mobile Money' THEN '1020' END,
               0,NEW.amount,NEW.created_at
        FROM journal_entries WHERE reference=NEW.reference;
      END;
    "#).await.map_err(|e| e.to_string())?;

    Ok(())
}

/// Map the existing UI payment-account names to the chart of accounts.
pub fn cash_account_code(account: &str) -> Result<&'static str, String> {
    match account.trim() {
        "Cash" => Ok("1000"),
        "Bank" => Ok("1010"),
        "Mobile Money" => Ok("1020"),
        other => Err(format!("Unsupported cash account: {other}")),
    }
}

/// Post one balanced, immutable journal entry inside the caller's transaction.
/// The transaction is deliberately not committed here: operational and accounting
/// records must commit or roll back together.
pub async fn post_journal(
    tx: &turso::transaction::Transaction<'_>,
    reference: &str,
    description: &str,
    entry_date: &str,
    lines: &[JournalLine],
) -> Result<(), String> {
    if lines.len() < 2 {
        return Err("A journal entry requires at least two lines".into());
    }

    let mut debit_total = 0.0;
    let mut credit_total = 0.0;
    for line in lines {
        if !line.debit.is_finite() || !line.credit.is_finite() || line.debit < 0.0 || line.credit < 0.0 {
            return Err("Journal amounts must be finite and non-negative".into());
        }
        if (line.debit > 0.0) == (line.credit > 0.0) {
            return Err("Each journal line must contain either a debit or a credit".into());
        }
        debit_total += line.debit;
        credit_total += line.credit;
    }

    if (debit_total - credit_total).abs() > 0.005 {
        return Err(format!("Unbalanced journal entry: debits {:.2}, credits {:.2}", debit_total, credit_total));
    }
    if debit_total <= 0.0 {
        return Err("Journal entry amount must be greater than zero".into());
    }

    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO journal_entries(reference,description,entry_date,status,created_at) VALUES(?1,?2,?3,'POSTED',?4)",
        turso::params![reference, description, entry_date, now.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;
    let entry_id = tx.last_insert_rowid();

    for line in lines {
        tx.execute(
            "INSERT INTO journal_lines(journal_entry_id,account_code,debit,credit,created_at) VALUES(?1,?2,?3,?4,?5)",
            turso::params![entry_id, line.account_code.trim(), line.debit, line.credit, now.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    // Final invariant check is performed before the surrounding transaction commits.
    let mut rows = tx
        .query(
            "SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) FROM journal_lines WHERE journal_entry_id=?1",
            turso::params![entry_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("Journal verification failed")?;
    let debits: f64 = row.get(0).map_err(|e| e.to_string())?;
    let credits: f64 = row.get(1).map_err(|e| e.to_string())?;
    if (debits - credits).abs() > 0.005 {
        return Err("Journal verification failed: entry is not balanced".into());
    }

    Ok(())
}