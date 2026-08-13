# Windows Release

## Development
```powershell
npm install
npm run tauri dev
```

## Production
```powershell
npm run build
npm run tauri build
```

The Tauri configuration targets MSI and NSIS.

For a commercial release:
1. Configure a Windows code-signing certificate.
2. Sign the installer and executable.
3. Verify WebView2 bootstrapper behavior on clean Windows 10/11 machines.
4. Test offline startup with Wi-Fi disabled.
5. Test POS sale while offline.
6. Reconnect and verify Turso sync.
7. Test backup/restore before upgrading.
