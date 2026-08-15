use crate::accounting_core::{EventType, JournalEntry, JournalLine};

#[derive(Debug, Clone, PartialEq)]
pub struct SaleLine {
    pub sku: String,
    pub qty: f64,
    pub unit_price: f64,
}

impl SaleLine {
    pub fn total(&self) -> Result<f64, String> {
        if self.sku.trim().is_empty() { return Err("SKU is required".into()); }
        if !self.qty.is_finite() || self.qty <= 0.0 { return Err("Sale quantity must be greater than zero".into()); }
        if !self.unit_price.is_finite() || self.unit_price <= 0.0 { return Err("Sale unit price must be greater than zero".into()); }
        Ok(self.qty * self.unit_price)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct InventoryState {
    pub qty: f64,
    pub unit_cost: f64,
}

impl InventoryState {
    pub fn issue(&self, line: &SaleLine) -> Result<(Self, f64), String> {
        let revenue = line.total()?;
        if !self.qty.is_finite() || self.qty < 0.0 { return Err("Inventory quantity is invalid".into()); }
        if !self.unit_cost.is_finite() || self.unit_cost < 0.0 { return Err("Inventory unit cost is invalid".into()); }
        if line.qty > self.qty + 0.000001 { return Err(format!("Insufficient inventory for SKU {}", line.sku)); }
        let cogs = line.qty * self.unit_cost;
        Ok((Self { qty: self.qty - line.qty, unit_cost: self.unit_cost }, cogs))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SalePosting {
    pub journal: JournalEntry,
    pub total_revenue: f64,
    pub total_cogs: f64,
    pub inventory_after: Vec<(String, InventoryState)>,
}

/// Builds the complete accounting consequence of a sale.
/// Cash sale: DR Cash / CR Sales Revenue; DR COGS / CR Inventory.
/// Credit sale uses Accounts Receivable instead of Cash.
pub fn post_sale(
    reference: impl Into<String>,
    posted_at: impl Into<String>,
    lines: &[SaleLine],
    credit_sale: bool,
    debit_account: impl Into<String>,
    revenue_account: impl Into<String>,
    inventory_account: impl Into<String>,
    cogs_account: impl Into<String>,
    opening_inventory: &[(String, InventoryState)],
) -> Result<SalePosting, String> {
    if lines.is_empty() { return Err("Sale must contain at least one line".into()); }

    let mut total_revenue = 0.0;
    let mut total_cogs = 0.0;
    let mut inventory_after = Vec::with_capacity(lines.len());

    for line in lines {
        let existing = opening_inventory.iter()
            .find(|(sku, _)| sku == &line.sku)
            .map(|(_, state)| state.clone())
            .ok_or_else(|| format!("SKU {} is not in inventory", line.sku))?;
        let (updated, cogs) = existing.issue(line)?;
        total_revenue += line.total()?;
        total_cogs += cogs;
        inventory_after.push((line.sku.clone(), updated));
    }

    let debit_account = debit_account.into();
    let revenue_account = revenue_account.into();
    let inventory_account = inventory_account.into();
    let cogs_account = cogs_account.into();

    let journal = JournalEntry::post(
        reference,
        EventType::Sale,
        "Inventory sale",
        posted_at,
        vec![
            JournalLine::debit(debit_account, total_revenue)?,
            JournalLine::credit(revenue_account, total_revenue)?,
            JournalLine::debit(cogs_account, total_cogs)?,
            JournalLine::credit(inventory_account, total_cogs)?,
        ],
    )?;

    let _ = credit_sale;
    Ok(SalePosting { journal, total_revenue, total_cogs, inventory_after })
}
