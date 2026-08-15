#[path = "../src/accounting_core.rs"]
mod accounting_core;
#[path = "../src/purchase_core.rs"]
mod purchase_core;

use purchase_core::{post_purchase, InventoryState, PurchaseLine};

#[test]
fn cash_purchase_posts_balanced_entry_and_updates_inventory() {
    let lines = vec![PurchaseLine { sku: "SKU-1".into(), qty: 10.0, unit_cost: 100.0 }];
    let result = post_purchase(
        "PUR-1", "2026-01-01", &lines, false,
        "1200-INVENTORY", "1000-CASH", "2000-AP", &[]
    ).unwrap();

    assert_eq!(result.total, 1000.0);
    assert!(result.journal.is_balanced());
    assert_eq!(result.journal.total_debit(), 1000.0);
    assert_eq!(result.journal.total_credit(), 1000.0);
    assert_eq!(result.inventory_after[0].1.qty, 10.0);
    assert_eq!(result.inventory_after[0].1.unit_cost, 100.0);
}

#[test]
fn credit_purchase_credits_payables() {
    let lines = vec![PurchaseLine { sku: "SKU-1".into(), qty: 5.0, unit_cost: 200.0 }];
    let result = post_purchase(
        "PUR-2", "2026-01-01", &lines, true,
        "1200-INVENTORY", "1000-CASH", "2000-AP", &[]
    ).unwrap();

    assert!(result.journal.is_balanced());
    assert_eq!(result.journal.lines[0].account, "1200-INVENTORY");
    assert_eq!(result.journal.lines[1].account, "2000-AP");
}

#[test]
fn purchase_uses_weighted_average_cost() {
    let opening = vec![("SKU-1".into(), InventoryState { qty: 10.0, unit_cost: 100.0 })];
    let lines = vec![PurchaseLine { sku: "SKU-1".into(), qty: 10.0, unit_cost: 200.0 }];
    let result = post_purchase(
        "PUR-3", "2026-01-01", &lines, false,
        "1200-INVENTORY", "1000-CASH", "2000-AP", &opening
    ).unwrap();

    assert_eq!(result.inventory_after[0].1.qty, 20.0);
    assert!((result.inventory_after[0].1.unit_cost - 150.0).abs() < 0.000001);
}

#[test]
fn invalid_purchase_is_rejected() {
    let lines = vec![PurchaseLine { sku: "SKU-1".into(), qty: 0.0, unit_cost: 100.0 }];
    assert!(post_purchase(
        "PUR-BAD", "2026-01-01", &lines, false,
        "1200-INVENTORY", "1000-CASH", "2000-AP", &[]
    ).is_err());
}
