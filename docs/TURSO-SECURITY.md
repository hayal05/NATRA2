# Turso secret policy

Never ship:
- TURSO_AUTH_TOKEN
- master database tokens
- JWT signing secrets

inside:
- JavaScript bundles
- Tauri config
- installer resources
- source control
- customer documentation

The only service that receives the master Turso credential is the Sync API.

Customer access is through short-lived application sessions. The Windows app stores its session credential using the operating system credential store via the Rust keyring integration.

The Turso master token should be rotated periodically and immediately after suspected exposure.
