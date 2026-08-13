# v1.0 production architecture

- Multi-tenant architecture for 200 companies.
- One master Turso database retained on the trusted Sync API only.
- Windows app switched to local-only database startup.
- Added secure OS credential storage for application sessions.
- Added Sync API authentication and tenant-scoped push/pull endpoints.
- Added master database schema for companies, users, devices, tenant records, sync events and audit events.
- Added local sync-outbox migration.
- Added production security and deployment documentation.
