# NATRA Management v1.2.0 — Production Candidate

This archive contains the hardened Tauri desktop source, local/offline database
layer, optional Turso synchronization, server foundation, backup/restore
commands, security hardening, QA script and Windows build instructions.

## Verification performed in this environment
- JavaScript syntax checks passed.
- JSON configuration checks passed.
- Static production QA passed.
- No production demo KPI/product data remains.
- No real credentials were found in the package.

## Not verified here
The environment does not contain Rust/Cargo and dependency installation could
not complete, so a Windows MSI/NSIS build and runtime acceptance test have not
been performed.

## Required final step
On a Windows build machine, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

Then complete `docs/production-checklist.md` and code-sign the installers before
commercial distribution.
