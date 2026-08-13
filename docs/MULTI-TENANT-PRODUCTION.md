# Multi-tenant production architecture

## Decision

Use **one master Turso database** for the 200-company SaaS backend, but **do not distribute its Turso token to customer PCs**.

Customer Windows installations use a local Turso/SQLite database only. The trusted Sync API owns the master Turso credential and exposes authenticated tenant-scoped endpoints.

### Why

A direct embedded replica of a single master database would put a replica containing the shared dataset on every customer's PC. That is not acceptable for tenant isolation. Turso's current documentation recommends its local-first `turso` sync approach for true local writes, while the serverless client is intended for trusted server-side remote access.

## Runtime

Windows client:
- local database
- offline POS/inventory/cash flow
- encrypted/OS-protected session credential
- sync outbox
- authenticated API calls when online

Sync API:
- authenticates user
- determines company_id from the signed session
- never trusts a company_id supplied by the client
- holds the master Turso token
- validates every sync event against the authenticated tenant
- writes tenant-scoped records/events

Master Turso:
- companies
- users
- devices
- tenant_records
- sync_events
- audit_events

## Tenant isolation

A request must derive company_id from the verified JWT. The client must never be able to select another company by changing a local company_id field.

## Deployment

1. Create the master Turso database.
2. Apply `database/master_001_multitenant.sql`.
3. Deploy `server/`.
4. Put `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `JWT_SECRET` only in the server's secret manager/environment.
5. Configure HTTPS and a fixed CORS origin.
6. Disable `/v1/auth/hash-password` in production (it is already disabled when NODE_ENV=production).
7. Create companies/users through a protected admin provisioning process.
8. Build the Windows client. It contains no Turso master credential.
