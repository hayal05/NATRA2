# v1.0 RC.2 QA results

## Static checks
- JavaScript source files pass Node syntax checking.
- Package metadata is present.
- Tauri configuration targets MSI and NSIS.
- Duplicate customer-payment schema/function introduced in the prior RC was removed.
- Supplier, backup, and sync-status commands are registered in the Tauri handler.

## Environment limitation
This environment does not contain the Rust/Cargo toolchain and cannot produce a Windows MSI/NSIS installer. `npm install` also could not complete within the available execution window.

Therefore this package is **not certified as production-ready** until it is compiled and tested on Windows.

## Required Windows validation
Run `powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1`, then execute the acceptance tests in `docs/V1-RELEASE-CANDIDATE.md`.
