# Security checklist

- Never commit TURSO_AUTH_TOKEN to source control.
- Use environment variables only for development.
- Store production secrets in Windows Credential Manager/DPAPI-backed storage.
- Enforce permissions inside Rust commands, not only by hiding UI buttons.
- Hash passwords with Argon2id or another modern password KDF.
- Use short-lived sessions and explicit logout.
- Never log passwords, auth tokens, or other secrets.
