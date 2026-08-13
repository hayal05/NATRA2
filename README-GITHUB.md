# NATRA Management — GitHub Setup

This repository is prepared for a GitHub-only workflow using Codespaces and GitHub Actions.

## Browser-only workflow

1. Create a GitHub repository named `NATRA-Management`.
2. Upload the project files to the repository. GitHub browser uploads support up to 100 files at once and 25 MiB per file.
3. Open **Code → Codespaces → Create codespace on main**.
4. In the Codespaces terminal run `npm install`, `npm run qa`, and `npm run build`.
5. Commit and push changes.
6. To create a Windows release, create/push a tag such as `v1.2.0`. GitHub Actions will build NSIS and MSI installers and create a draft Release.

## Important

- Replace `@YOUR_GITHUB_USERNAME` in `CODEOWNERS`.
- Keep the repository private until licensing and security review are complete.
- Do not commit `.env` files, secrets, customer data, or production databases.
- The first Windows installer must be tested before commercial distribution.
