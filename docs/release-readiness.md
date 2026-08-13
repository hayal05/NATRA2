# NATRA Management v1.1.0 — Release Readiness

This package is a hardened production candidate, not a certified Windows release. The repository environment used for this build does not contain Rust/Cargo, so the MSI/NSIS binaries could not be compiled here.

### Completed hardening
- Secure cloud credential storage
- Offline/local startup
- Transactional financial operations
- UUID references
- Weighted-average purchase costing
- Duplicate-return prevention
- Real logical backup/restore
- Schema version marker
- Server-side CORS/security/rate-limit hardening
- No demo data on first launch
- NATRA Management branding

### Mandatory sign-off
- [ ] Windows build succeeds with `npm ci` and `npm run tauri build`.
- [ ] MSI and NSIS installers install/uninstall cleanly.
- [ ] Upgrade from v1.0 preserves the database.
- [ ] Fresh install starts offline without cloud credentials.
- [ ] Secure cloud credentials survive restart and never appear in localStorage.
- [ ] POS payment method is persisted correctly.
- [ ] Financial operations are atomic under forced interruption.
- [ ] Backup restores to a clean test machine.
- [ ] Sync push/pull works with production Turso credentials.
- [ ] Role restrictions are enforced at command/API boundaries.
- [ ] Installer and executable are code-signed.
- [ ] Production monitoring, support contact and recovery procedures are documented.
