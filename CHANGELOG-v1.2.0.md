# NATRA Management v1.2.0

## UI restructuring and feature expansion

- Reworked navigation to mirror the reference management-app information architecture.
- Added Products, Categories, Stock Adjustments, Low Stock, Stock Movement, Sales, Returns, Customers, Purchases, Purchase History, Suppliers, Transactions, Income, Expenses, Transfers, Cash Flow, Reports, Settings, and Backup & Restore sections.
- Redesigned dashboard around six KPI cards, sales/profit visualization, inventory value by category, alerts, top-selling products, cash flow summary, and recent transactions.
- Added customer receivable payment workflow.
- Added supplier management workflow.
- Added logical backup/restore UI and sync status.
- Added real backend commands for categories, stock adjustments, other income, account transfers, stock movements, sales history, and purchase history.
- Added responsive/collapsible navigation and global Ctrl+K search.
- Preserved offline-first operation and NATRA Tech footer branding.

## Validation

Static QA passes. Windows/Tauri compilation still requires a Rust toolchain on the release/build machine.
