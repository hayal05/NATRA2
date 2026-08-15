-- NATRA accounting core
-- This migration is intentionally additive. It introduces a balanced journal
-- without changing existing business tables yet.

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  normal_balance TEXT NOT NULL CHECK(normal_balance IN ('DEBIT','CREDIT')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_id TEXT,
  event_date TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','VOIDED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES accounting_journals(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounting_accounts(id),
  debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
  memo TEXT,
  CHECK(NOT (debit > 0 AND credit > 0)),
  CHECK(debit > 0 OR credit > 0)
);

CREATE INDEX IF NOT EXISTS idx_accounting_journals_date
  ON accounting_journals(event_date);
CREATE INDEX IF NOT EXISTS idx_accounting_journals_event
  ON accounting_journals(event_type,event_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_journal
  ON accounting_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account
  ON accounting_journal_lines(account_id);

-- Core chart of accounts. Codes are stable so reporting can use account codes
-- rather than fragile UI labels.
INSERT OR IGNORE INTO accounting_accounts(code,name,account_type,normal_balance,created_at) VALUES
 ('1000','Cash','ASSET','DEBIT',CURRENT_TIMESTAMP),
 ('1010','Bank','ASSET','DEBIT',CURRENT_TIMESTAMP),
 ('1020','Mobile Money','ASSET','DEBIT',CURRENT_TIMESTAMP),
 ('1100','Accounts Receivable','ASSET','DEBIT',CURRENT_TIMESTAMP),
 ('1200','Inventory','ASSET','DEBIT',CURRENT_TIMESTAMP),
 ('2000','Accounts Payable','LIABILITY','CREDIT',CURRENT_TIMESTAMP),
 ('3000','Owner Equity','EQUITY','CREDIT',CURRENT_TIMESTAMP),
 ('4000','Sales Revenue','REVENUE','CREDIT',CURRENT_TIMESTAMP),
 ('4100','Sales Returns & Allowances','REVENUE','DEBIT',CURRENT_TIMESTAMP),
 ('5000','Cost of Goods Sold','EXPENSE','DEBIT',CURRENT_TIMESTAMP),
 ('6000','Operating Expenses','EXPENSE','DEBIT',CURRENT_TIMESTAMP),
 ('6100','Inventory Adjustment Gain/Loss','EXPENSE','DEBIT',CURRENT_TIMESTAMP),
 ('6200','Tax Expense','EXPENSE','DEBIT',CURRENT_TIMESTAMP);

-- Accounting invariant: every POSTED journal must balance.
-- Enforcement is performed transactionally by the posting helper in lib.rs:
-- SUM(debit) must equal SUM(credit), and a journal with no lines is rejected.

-- Business-event posting map for the next integration step:
-- SALE (cash):       Dr Cash/Bank/Mobile Money; Cr Sales Revenue
-- SALE (credit):     Dr Accounts Receivable;     Cr Sales Revenue
-- SALE inventory:    Dr Cost of Goods Sold;      Cr Inventory
-- CUSTOMER PAYMENT:  Dr Cash/Bank/Mobile Money;  Cr Accounts Receivable
-- PURCHASE (cash):   Dr Inventory;               Cr Cash/Bank/Mobile Money
-- PURCHASE (credit): Dr Inventory;               Cr Accounts Payable
-- EXPENSE:           Dr Operating Expenses;      Cr Cash/Bank/Mobile Money
-- RETURN:            Dr Sales Returns;            Cr Cash/Receivable
-- RETURN inventory:  Dr Inventory;               Cr Cost of Goods Sold
-- STOCK INCREASE:    Dr Inventory;               Cr Inventory Adjustment Gain/Loss
-- STOCK DECREASE:    Dr Inventory Adjustment Loss; Cr Inventory
-- TRANSFER:          Dr destination cash account; Cr source cash account
