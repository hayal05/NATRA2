use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub code: String,
    pub name: String,
    pub kind: AccountKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AccountKind { Asset, Liability, Equity, Revenue, Expense }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JournalLine {
    pub account: String,
    pub debit: f64,
    pub credit: f64,
}

impl JournalLine {
    pub fn debit(account: impl Into<String>, amount: f64) -> Result<Self, String> {
        validate_amount(amount)?;
        Ok(Self { account: account.into(), debit: amount, credit: 0.0 })
    }
    pub fn credit(account: impl Into<String>, amount: f64) -> Result<Self, String> {
        validate_amount(amount)?;
        Ok(Self { account: account.into(), debit: 0.0, credit: amount })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JournalEntry {
    pub id: String,
    pub reference: String,
    pub event_type: EventType,
    pub description: String,
    pub posted_at: String,
    pub status: EntryStatus,
    pub lines: Vec<JournalLine>,
    pub reversal_of: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EntryStatus { Posted, Reversed }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EventType { Sale, Purchase, CustomerPayment, SupplierPayment, Expense, OtherIncome, CashTransfer }

impl JournalEntry {
    pub fn post(reference: impl Into<String>, event_type: EventType, description: impl Into<String>, posted_at: impl Into<String>, lines: Vec<JournalLine>) -> Result<Self, String> {
        validate_lines(&lines)?;
        Ok(Self { id: Uuid::new_v4().simple().to_string(), reference: reference.into(), event_type, description: description.into(), posted_at: posted_at.into(), status: EntryStatus::Posted, lines, reversal_of: None })
    }

    /// Creates the exact accounting opposite without modifying the original.
    pub fn reversal(&self, reference: impl Into<String>, posted_at: impl Into<String>) -> Result<Self, String> {
        if self.status != EntryStatus::Posted { return Err("Only a posted entry can be reversed".into()); }
        if self.reversal_of.is_some() { return Err("A reversal entry cannot itself be reversed".into()); }
        let lines = self.lines.iter().map(|line| JournalLine { account: line.account.clone(), debit: line.credit, credit: line.debit }).collect::<Vec<_>>();
        validate_lines(&lines)?;
        Ok(Self { id: Uuid::new_v4().simple().to_string(), reference: reference.into(), event_type: self.event_type.clone(), description: format!("Reversal of {}", self.reference), posted_at: posted_at.into(), status: EntryStatus::Posted, lines, reversal_of: Some(self.id.clone()) })
    }

    pub fn total_debit(&self) -> f64 { self.lines.iter().map(|line| line.debit).sum() }
    pub fn total_credit(&self) -> f64 { self.lines.iter().map(|line| line.credit).sum() }
    pub fn is_balanced(&self) -> bool { amounts_equal(self.total_debit(), self.total_credit()) }
}

pub struct PostingEngine;

impl PostingEngine {
    pub fn sale(reference: impl Into<String>, posted_at: impl Into<String>, debit_account: impl Into<String>, revenue_account: impl Into<String>, inventory_account: impl Into<String>, cogs_account: impl Into<String>, revenue: f64, cogs: f64) -> Result<JournalEntry, String> {
        validate_amount(revenue)?; validate_amount(cogs)?;
        JournalEntry::post(reference, EventType::Sale, "Sale", posted_at, vec![JournalLine::debit(debit_account, revenue)?, JournalLine::credit(revenue_account, revenue)?, JournalLine::debit(cogs_account, cogs)?, JournalLine::credit(inventory_account, cogs)?])
    }
    pub fn purchase(reference: impl Into<String>, posted_at: impl Into<String>, inventory_account: impl Into<String>, credit_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::Purchase, "Purchase", posted_at, vec![JournalLine::debit(inventory_account, amount)?, JournalLine::credit(credit_account, amount)?])
    }
    pub fn expense(reference: impl Into<String>, posted_at: impl Into<String>, expense_account: impl Into<String>, credit_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::Expense, "Expense", posted_at, vec![JournalLine::debit(expense_account, amount)?, JournalLine::credit(credit_account, amount)?])
    }
    pub fn other_income(reference: impl Into<String>, posted_at: impl Into<String>, debit_account: impl Into<String>, income_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::OtherIncome, "Other income", posted_at, vec![JournalLine::debit(debit_account, amount)?, JournalLine::credit(income_account, amount)?])
    }
    pub fn customer_payment(reference: impl Into<String>, posted_at: impl Into<String>, cash_account: impl Into<String>, receivable_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::CustomerPayment, "Customer payment", posted_at, vec![JournalLine::debit(cash_account, amount)?, JournalLine::credit(receivable_account, amount)?])
    }
    pub fn supplier_payment(reference: impl Into<String>, posted_at: impl Into<String>, payable_account: impl Into<String>, cash_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::SupplierPayment, "Supplier payment", posted_at, vec![JournalLine::debit(payable_account, amount)?, JournalLine::credit(cash_account, amount)?])
    }
    pub fn cash_transfer(reference: impl Into<String>, posted_at: impl Into<String>, from_account: impl Into<String>, to_account: impl Into<String>, amount: f64) -> Result<JournalEntry, String> {
        validate_amount(amount)?;
        JournalEntry::post(reference, EventType::CashTransfer, "Cash transfer", posted_at, vec![JournalLine::debit(to_account, amount)?, JournalLine::credit(from_account, amount)?])
    }
}

fn validate_amount(amount: f64) -> Result<(), String> {
    if !amount.is_finite() || amount <= 0.0 { return Err("Amount must be finite and greater than zero".into()); }
    Ok(())
}

fn validate_lines(lines: &[JournalLine]) -> Result<(), String> {
    if lines.len() < 2 { return Err("A journal entry requires at least two lines".into()); }
    for line in lines {
        if line.account.trim().is_empty() { return Err("Journal account is required".into()); }
        if line.debit < 0.0 || line.credit < 0.0 || !line.debit.is_finite() || !line.credit.is_finite() { return Err("Journal amounts cannot be negative or non-finite".into()); }
        if line.debit > 0.0 && line.credit > 0.0 { return Err("A journal line cannot contain both debit and credit".into()); }
        if amounts_equal(line.debit, 0.0) && amounts_equal(line.credit, 0.0) { return Err("A journal line must contain a debit or credit amount".into()); }
    }
    let debit: f64 = lines.iter().map(|line| line.debit).sum();
    let credit: f64 = lines.iter().map(|line| line.credit).sum();
    if !amounts_equal(debit, credit) { return Err(format!("Unbalanced journal: debit={debit}, credit={credit}")); }
    Ok(())
}

fn amounts_equal(a: f64, b: f64) -> bool { (a - b).abs() <= 0.000001 }
