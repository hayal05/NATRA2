#[path = "../src/accounting_core.rs"]
mod accounting_core;
#[path = "../src/sales_core.rs"]
mod sales_core;

use sales_core::{post_sale, InventoryState, SaleLine};

#[test]
fn cash_sale_posts_revenue_cogs_and_inventory() {
    let lines = vec![SaleLine { sku: "SKU-1".into(), qty: 2.0, unit_price: 100.0 }];
    let opening = vec![("SKU-1".into(), InventoryState { qty: 10.0, unit_cost: 60.0 })];
    let posting = post_sale("SAL-1", "2026-01-01", &lines, "1000-CASH", "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening).unwrap();

    assert!(posting.journal.is_balanced());
    assert_eq!(posting.total_revenue, 200.0);
    assert_eq!(posting.total_cogs, 120.0);
    assert_eq!(posting.inventory_after[0].1.qty, 8.0);
    assert_eq!(posting.inventory_after[0].1.unit_cost, 60.0);
}

#[test]
fn credit_sale_uses_receivable_account() {
    let lines = vec![SaleLine { sku: "SKU-1".into(), qty: 1.0, unit_price: 150.0 }];
    let opening = vec![("SKU-1".into(), InventoryState { qty: 5.0, unit_cost: 90.0 })];
    let posting = post_sale("SAL-2", "2026-01-01", &lines, "1100-AR", "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening).unwrap();

    assert!(posting.journal.is_balanced());
    assert_eq!(posting.journal.lines[0].account, "1100-AR");
    assert_eq!(posting.journal.lines[0].debit, 150.0);
    assert_eq!(posting.journal.lines[2].debit, 90.0);
}

#[test]
fn insufficient_inventory_is_rejected() {
    let lines = vec![SaleLine { sku: "SKU-1".into(), qty: 6.0, unit_price: 100.0 }];
    let opening = vec![("SKU-1".into(), InventoryState { qty: 5.0, unit_cost: 60.0 })];
    assert!(post_sale("SAL-3", "2026-01-01", &lines, "1000-CASH", "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening).is_err());
}

#[test]
fn unknown_product_is_rejected() {
    let lines = vec![SaleLine { sku: "MISSING".into(), qty: 1.0, unit_price: 100.0 }];
    let opening = vec![("SKU-1".into(), InventoryState { qty: 5.0, unit_cost: 60.0 })];
    assert!(post_sale("SAL-4", "2026-01-01", &lines, "1000-CASH", "4000-SALES", "1200-INVENTORY", "5000-COGS", &opening).is_err());
}
