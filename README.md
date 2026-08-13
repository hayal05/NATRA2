# Smart Inventory Pro — Tauri Windows v0.2

Offline-first inventory management desktop app using:

- Tauri 2
- Vanilla HTML/CSS/JavaScript
- Chart.js
- Rust
- Turso Sync (`turso` Rust crate) for true local-first writes + push/pull sync

## Important architecture note

Turso's current documentation recommends **Turso Sync** for new offline-first applications. The older libSQL Embedded Replica mode is legacy and normally sends writes to the remote primary. Turso Sync keeps reads and writes local and explicitly pushes/pulls changes. This project therefore implements the current local-first architecture rather than the older remote-write embedded-replica behavior.

## Windows prerequisites

Install Node.js LTS, Rust, Microsoft C++ Build Tools with the Desktop development with C++ workload, and WebView2. Tauri's Windows prerequisites are documented at https://v2.tauri.app/start/prerequisites/.

## Setup

```powershell
npm install
```

Set the Turso credentials in the environment before launching:

```powershell
$env:TURSO_DATABASE_URL="libsql://your-db.turso.io"
$env:TURSO_AUTH_TOKEN="your-token"
```

Then:

```powershell
npm run tauri dev
```

Build the Windows installers:

```powershell
npm run tauri build
```

The Tauri bundle is configured for both NSIS and MSI.

## Current MVP

Implemented:

- Professional dashboard shell
- KPI cards
- Chart.js sales/profit and inventory charts
- Product inventory list
- Low-stock status logic
- POS cart
- Offline sale recording
- Automatic COGS/profit calculation
- Stock decrement + stock movement ledger
- Cash transaction creation for sales
- Dashboard aggregation from database
- Turso Sync push/pull command
- Local database in the Tauri application-data directory

Next production pass should add:

- Product CRUD modal (add/edit/archive)
- Purchase receiving workflow
- Expense recording workflow
- Returns
- Full transaction history
- Customer/supplier accounts
- Barcode scanner/printing
- Receipt printing
- Role-based permissions
- OS-secure credential storage
- Database migrations
- Conflict/error queue and sync status
- Backup/export
- PDF/Excel reporting
- Automated scheduled sync

## v0.3 additions

- Customer directory with credit limits and receivable balances
- Unified cash transaction ledger UI
- Customer CRUD foundation
- Receipt print flow after POS completion
- Fixed duplicate Rust product field in the previous MVP
- Added customer/sales relationship tables for future credit-sales workflows

## Production roadmap after v0.3

1. Proper migrations/version table instead of bootstrap-only schema creation.
2. Secure Turso token storage using the OS keychain rather than environment variables.
3. True credit sale workflow that links a sale to a customer and updates receivables.
4. Returns/refunds with reversal stock movements and accounting entries.
5. Barcode scanner input and label/receipt printer support.
6. CSV/XLSX/PDF export and scheduled backups.
7. Roles/permissions and audit log.
8. Sync conflict/error queue with visible status and retry controls.

## v0.4 additions
- Returns and refunds with quantity validation against original sale line
- Customer receivable payments
- Live management report summary
- CSV report export from the desktop UI
- POS barcode/SKU keyboard-wedge scanning behavior (scan exact SKU to add to cart)
- Additional return and payment database tables


## v0.5 production-hardening scope

Added foundations for:
- Credit sales and customer receivables
- Customer payment workflow
- Supplier master data
- Printable POS receipts
- CSV/Excel-ready report data export
- User/role and audit-log schema
- Backup/restore command foundation
- Sync status/conflict queue foundation
- Versioned database migration table
- Windows packaging settings for NSIS/MSI

Security note: production credentials should be stored in the OS credential store/keyring rather than plaintext configuration files. The current UI intentionally treats Turso credentials as configuration inputs and should be connected to a secure storage implementation before production deployment.
