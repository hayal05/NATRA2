# NATRA Management — Production Checklist (v1.1.0)

## Hardened in this build
- Local-only startup is supported when cloud credentials are not configured.
- Cloud credentials are read from the OS credential store (Windows Credential Manager via `keyring`) rather than localStorage.
- Sample/demo product data is no longer inserted automatically.
- Sales, purchases, expenses, returns and customer payments use database transactions.
- Transaction references use UUIDs to avoid collisions.
- Purchase receiving uses weighted-average inventory cost.
- Duplicate returns are prevented beyond the original sold quantity.
- Customer payments cannot exceed the outstanding receivable.
- Real logical SQL backup export and validated restore command are included.
- Schema migration version marker is recorded.
- Production server requires JWT secret, Turso credentials and explicit CORS origins.
- Login endpoint has basic rate limiting and security headers.
- Windows build script uses `npm ci` and fails fast when Rust/Cargo is missing.
- NATRA Management branding and `Powered by NATRA Tech © 2026` footer are included.

## Still required before commercial release
1. Compile and run the Tauri application on a clean Windows 10/11 machine.
2. Code-sign the executable and MSI/NSIS installer with your production certificate.
3. Provision a production Turso database and validate tenant isolation.
4. Run backup/restore tests on a separate machine.
5. Test offline sales, purchases, returns and payments under power/network interruption.
6. Test cloud sync conflict scenarios with two Windows devices.
7. Add a formal installer upgrade/uninstall migration test.
8. Review the remaining role/permission enforcement in every sensitive command.
9. Add automated CI for Node, Rust, dependency audit and Windows packaging.
10. Consider moving the embedded database layer to a production-stable engine/version before mission-critical deployment; the current `turso` 0.7.x engine is still evolving.

## Build
Run on a Windows build machine:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

Artifacts are produced under `src-tauri/target/release/bundle/`.
