$ErrorActionPreference = "Stop"

$version = (Get-Content (Join-Path $PSScriptRoot "..\package.json") | ConvertFrom-Json).version
Write-Host "NATRA Management v$version - Windows production build"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "Rust/Cargo is required. Install the current stable Rust toolchain and retry." }

npm install
npm run build
npm run tauri build

$bundle = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle"
if (-not (Test-Path $bundle)) { throw "Tauri bundle output was not created." }

Write-Host "Build complete:"
Get-ChildItem -Path $bundle -Recurse -File | Where-Object { $_.Extension -in ".msi",".exe" } | Select-Object FullName,Length
