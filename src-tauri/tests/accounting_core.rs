#[path = "../src/accounting_core.rs"]
mod accounting_core;

use accounting_core::{EventType, JournalEntry, JournalLine, PostingEngine};

#[test]
fn all_core_templates_balance() {
    let entries = [
        PostingEngine::sale("SAL-1", "2026-01-01", "1000-CASH", "4000-SALES", "1200-INVENTORY", "5000-COGS", 1000.0, 600.0).unwrap(),
        PostingEngine::purchase("PUR-1", "2026-01-01", "1200-INVENTORY", "2000-AP", 800.0).unwrap(),
        PostingEngine::expense("EXP-1", "2026-01-01", "6000-EXPENSE", "1000-CASH", 200.0).unwrap(),
        PostingEngine::other_income("INC-1", "2026-01-01", "1000-CASH", "4900-OTHER-INCOME", 150.0).unwrap(),
        PostingEngine::customer_payment("PAY-1", "2026-01-01", "1000-CASH", "1100-AR", 300.0).unwrap(),
        PostingEngine::supplier_payment("SPAY-1", "2026-01-01", "2000-AP", "1000-CASH", 300.0).unwrap(),
        PostingEngine::cash_transfer("TRF-1", "2026-01-01", "1000-CASH", "1010-BANK", 500.0).unwrap(),
    ];
    assert!(entries.iter().all(|entry| entry.is_balanced()));
}

#[test]
fn reversal_preserves_audit_link_and_exact_opposite() {
    let original = PostingEngine::sale("SAL-1", "2026-01-01", "1000-CASH", "4000-SALES", "1200-INVENTORY", "5000-COGS", 1000.0, 600.0).unwrap();
    let reversal = original.reversal("REV-1", "2026-01-02").unwrap();
    assert_eq!(reversal.reversal_of.as_deref(), Some(original.id.as_str()));
    assert!(reversal.is_balanced());
    assert_eq!(original.lines.len(), reversal.lines.len());
    for (original_line, reversal_line) in original.lines.iter().zip(reversal.lines.iter()) {
        assert_eq!(original_line.account, reversal_line.account);
        assert_eq!(original_line.debit, reversal_line.credit);
        assert_eq!(original_line.credit, reversal_line.debit);
    }
}

#[test]
fn reversal_of_reversal_is_rejected() {
    let original = PostingEngine::expense("EXP-1", "2026-01-01", "6000-EXPENSE", "1000-CASH", 50.0).unwrap();
    let reversal = original.reversal("REV-1", "2026-01-02").unwrap();
    assert!(reversal.reversal("REV-2", "2026-01-03").is_err());
}

#[test]
fn unbalanced_manual_entry_is_rejected() {
    let result = JournalEntry::post(
        "BAD-1",
        EventType::Expense,
        "Bad entry",
        "2026-01-01",
        vec![
            JournalLine::debit("6000-EXPENSE", 100.0).unwrap(),
            JournalLine::credit("1000-CASH", 99.0).unwrap(),
        ],
    );
    assert!(result.is_err());
}
