use crate::accounting_core::{EventType, JournalEntry, JournalLine};

#[derive(Debug, Clone, PartialEq)]
pub struct PurchaseLine {
    pub sku: String,
    pub qty: f64,
    pub unit_cost: f64,
}

impl PurchaseLine {
    pub fn total(&self) -> Result<f64, String> {
        if self.sku.trim().is_empty() { return Err("SKU is required".into()); }
        if !self.qty.is_finite() || self.qty <= 0.0 { return Err("Purchase quantity must be greater than zero".into()); }
        if !self.unit_cost.is_finite() || self.unit_cost <= 0.0 { return Err("Purchase unit cost must be greater than zero".into()); }
        Ok(self.qty * self.unit_cost)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct InventoryState {
    pub qty: f64,
    pub unit_cost: f64,
}

impl InventoryState {
    /// Weighted-average costing for a received purchase.
    pub fn receive(&self, line: &PurchaseLine) -> Result<Self, String> {
        let value_before = self.qty * self.unit_cost;
        let value_received = line.total()?;
        let new_qty = self.qty + line.qty;
        let new_cost = if new_qty.abs() <= f64::EPSILON {
            0.0
        } else {
            (value_before + value_received) / new_qty
        };
        Ok(Self { qty: new_qty, unit_cost: new_cost })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PurchasePosting {
    pub journal: JournalEntry,
    pub total: f64,
    pub inventory_after: Vec<(String, InventoryState)>,
}

/// Builds the complete accounting consequence of a purchase.
/// Cash purchase: DR Inventory / CR Cash.
/// Credit purchase: DR Inventory / CR Accounts Payable.
pub fn post_purchase(
    reference: impl Into<String>,
    posted_at: impl Into<String>,
    lines: &[PurchaseLine],
    credit_purchase: bool,
    inventory_account: impl Into<String>,
    cash_account: impl Into<String>,
    payable_account: impl Into<String>,
    opening_inventory: &[(String, InventoryState)],
) -> Result<PurchasePosting, String> {
    if lines.is_empty() { return Err("Purchase must contain at least one line".into()); }

    let mut total = 0.0;
    let mut inventory_after = Vec::with_capacity(lines.len());
    for line in lines {
        let existing = opening_inventory.iter()
            .find(|(sku, _)| sku == &line.sku)
            .map(|(_, state)| state.clone())
            .unwrap_or(InventoryState { qty: 0.0, unit_cost: 0.0 });
        let updated = existing.receive(line)?;
        total += line.total()?;
        inventory_after.push((line.sku.clone(), updated));
    }

    let credit_account = if credit_purchase { payable_account.into() } else { cash_account.into() };
    let journal = JournalEntry::post(
        reference,
        EventType::Purchase,
        "Inventory purchase",
        posted_at,
        vec![
            JournalLine::debit(inventory_account, total)?,
            JournalLine::credit(credit_account, total)?,
        ],
    )?;

    Ok(PurchasePosting { journal, total, inventory_after })
}
