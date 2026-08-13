# Smart Inventory Pro — v1.0 Release Candidate

This release candidate is intended for Windows QA before production deployment.

## Acceptance tests
1. Install on a clean Windows 10/11 machine.
2. Create/open the local database with no network.
3. Add products and receive stock while offline.
4. Complete a POS sale while offline; verify stock, COGS, profit and cash transaction.
5. Close/reopen offline and verify persistence.
6. Reconnect and verify Turso push/pull.
7. Test credit sale, customer payment and return/refund.
8. Test purchases, expenses and customer/supplier balances.
9. Print a receipt and export reports.
10. Create and restore a backup.
11. Verify roles and audit entries.
12. Interrupt synchronization and verify retry/conflict handling.
13. Verify financial totals against manually calculated test cases.
14. Test reinstall and recovery from backup.

## Production prerequisites
- Store the Turso URL/token in Windows Credential Manager or equivalent secure storage.
- Configure the production Turso database and access policies.
- Code-sign the executable and installer.
- Test backups and recovery on a separate machine.
- Remove all sample/demo credentials and data.
