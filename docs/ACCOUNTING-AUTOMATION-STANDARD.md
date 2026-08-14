# NATRA Accounting & Automation Standard

## Purpose

NATRA is an inventory/POS application, but its business events affect financial statements. The system therefore needs one consistent transaction model so that inventory, sales, receivables, cash, purchases, expenses, tax estimates and reports cannot drift apart.

This document is the implementation baseline for the accounting automation work.

## Accounting model

Every posted business event must have:

1. a unique immutable reference;
2. a transaction date/time and business date;
3. an actor/user;
4. a source document/module;
5. a status (`DRAFT`, `POSTED`, `VOIDED`, or `REVERSED` as applicable);
6. a complete audit trail;
7. balanced accounting impact when the event is financially material;
8. inventory impact where inventory is involved;
9. cash/receivable/payable impact according to settlement terms;
10. deterministic recalculation of dependent balances and reports.

## Required subledger relationships

### Sales

A completed cash sale should produce, conceptually:

- Dr Cash / Bank / Mobile Money
- Cr Sales Revenue
- Dr Cost of Goods Sold
- Cr Inventory

A credit sale should instead:

- Dr Accounts Receivable
- Cr Sales Revenue
- Dr Cost of Goods Sold
- Cr Inventory

A later customer payment should:

- Dr Cash / Bank / Mobile Money
- Cr Accounts Receivable

Revenue recognition must be separated from settlement method. IFRS 15 focuses revenue recognition on transfer of promised goods/services and consideration, not simply on whether cash was received. See the IFRS 15 implementation notes before adding non-POS revenue workflows.

### Purchases

A received inventory purchase should increase inventory and create either:

- Dr Inventory / Cr Cash or Bank when paid immediately; or
- Dr Inventory / Cr Accounts Payable when purchased on credit.

A later supplier payment should reduce Accounts Payable and cash.

### Inventory

Inventory is a perpetual subledger. Sales, purchases, returns, and approved adjustments must update stock through one controlled movement path. Direct edits to `products.stock` are not permitted for normal operations.

For interchangeable inventory, NATRA currently targets weighted-average costing. The cost engine must remain consistent by product class. IAS 2 permits FIFO or weighted average for ordinarily interchangeable items and requires inventory to be measured at the lower of cost and net realisable value. citeturn0search0turn0search49

### Returns

A customer return must reverse the appropriate revenue/cash or receivable effect and restore inventory. Refunds must not be recorded as a new expense unrelated to the original sale.

### Expenses

An expense should record the expense category and settlement account. If unpaid, it should create a payable rather than reducing cash immediately.

### Cash flow

Cash flow reporting must distinguish operating, investing and financing activities. Internal transfers between cash accounts are not external cash generation and must not inflate net cash flow. IAS 7 requires cash flows to be classified into operating, investing and financing activities and reconciled to the statement of financial position. citeturn0search1turn0search50

### Tax

Estimated tax is an estimate, not automatically a tax liability. Tax rules, rates, deductible items, filing periods and jurisdiction must be configurable. The current sidebar estimate must never be presented as a statutory tax filing or final tax payable without a jurisdiction-specific tax engine and review workflow.

## Internal controls

NATRA must follow the principles of strong internal control: controlled authorization, separation of duties where applicable, auditability, exception monitoring and continuous reconciliation. COSO identifies control environment, risk assessment, control activities, information/communication and monitoring as the five components of an effective internal-control framework. citeturn0search2turn0search3

Required controls include:

- immutable posted documents;
- reversal instead of destructive deletion for posted financial records;
- role-based approval for discounts, stock adjustments, voids, refunds and period close;
- audit log with actor and reason;
- unique references and idempotency protection;
- period locking after close;
- backup verification and restore testing;
- reconciliation exceptions visible to users;
- no hidden hard-coded tax/accounting rules.

## Financial reporting target

The accounting layer should support at minimum:

- Trial Balance;
- Statement of Financial Position / Balance Sheet;
- Statement of Profit or Loss;
- Statement of Cash Flows;
- Accounts Receivable ageing;
- Accounts Payable ageing;
- Inventory valuation and movement;
- Tax estimate / tax control account;
- sales and purchase registers;
- audit log and reconciliation exceptions.

IFRS 18 replaces IAS 1 for annual periods beginning on or after 1 January 2027 and introduces defined profit-or-loss subtotals and additional management-defined performance measure disclosures. NATRA should therefore avoid hard-coding a report design that assumes the older IAS 1 presentation forever. citeturn2search8turn2search39

## Automation requirements

The application should automatically:

- update stock after posted sales, purchases, returns and adjustments;
- update inventory valuation using the selected cost method;
- update revenue/COGS/gross profit;
- update cash/bank balances by account;
- update receivables/payables;
- update tax estimates from the configured taxable base;
- refresh dashboard and reports from the same source of truth;
- run reconciliation checks after material transactions;
- create actionable alerts for low stock, overdue receivables/payables, reconciliation differences and failed sync;
- retain enough history to reproduce any reported balance.

## Current implementation gaps found during the repository review

1. `products.stock` can still be overwritten by `save_product`, bypassing stock movement history.
2. `CreditSale` exists but the active `record_sale` workflow accepts only Cash, Bank and Mobile Money; credit sales/receivables are therefore incomplete.
3. `sale_customers` exists but is not integrated into the active sale posting path.
4. Purchases immediately create cash outflow and do not model Accounts Payable or credit purchases.
5. Cash transactions are a cash-event ledger, not a general ledger; there is no balanced journal/ledger layer.
6. `report_summary` and `dashboard_summary` derive financial totals directly from operational tables rather than a single posted accounting ledger.
7. Returns adjust sales and cash but do not use a formal reversal/credit-note workflow.
8. Posted financial records are not protected by a draft/post/void/reverse lifecycle.
9. The current backup preference is persisted in the UI, but the setting alone does not implement a scheduled/verified backup service.
10. The current estimated-tax feature is a configurable percentage of reported profit, not a jurisdiction-specific tax calculation.
11. Sync tables exist, but conflict resolution and accounting-level idempotency need a formal transaction/event model.
12. The current product form permits direct initial/current-stock edits; normal stock corrections should be routed through controlled inventory adjustments.

These gaps are not cosmetic. They are the next implementation priorities for a production accounting/inventory system.
