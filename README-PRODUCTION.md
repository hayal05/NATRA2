# NATRA Management — Production Deployment

## Desktop
NATRA Management is offline-first. The application can run locally without network access. When cloud credentials are configured, local changes can be synchronized with Turso.

### Secure cloud setup
1. Start the application without cloud credentials.
2. Open **Settings**.
3. Enter the production Turso URL and token.
4. Select **Securely Save Cloud Credentials**.
5. Restart the application.
6. Confirm the Settings status reports cloud sync as configured.

Credentials are stored using the OS credential store and are not written to browser localStorage.

### Backup
Use the application's backup command from the desktop integration or invoke `backup_database` with a destination path. The resulting SQL dump is self-contained and can be validated/restored using `restore_database`.

## Server
The optional sync API requires:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `JWT_SECRET` with at least 32 random characters
- `CORS_ORIGIN` in production

Do not use wildcard CORS in production.

## Windows release
Build on a Windows machine with Node.js and a current stable Rust toolchain:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

Sign the generated MSI/NSIS installer before distribution.

## Important
A source package is not equivalent to a certified production release. Complete the Windows acceptance checklist in `docs/production-checklist.md` before deploying to paying customers.
