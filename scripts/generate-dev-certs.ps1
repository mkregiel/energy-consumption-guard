$ErrorActionPreference = "Stop"

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Write-Error @"
mkcert is not installed.

Install with one of:
  winget install FiloSottile.mkcert
  choco install mkcert

Then re-run: npm run certs:generate
"@
    exit 1
}

Write-Host "Installing local CA (idempotent)..."
mkcert -install

$repoRoot = Split-Path $PSScriptRoot -Parent
$certsDir = Join-Path $repoRoot "certs"

if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir | Out-Null
}

Push-Location $certsDir
try {
    Write-Host "Generating certificates for 127.0.0.1 and localhost..."
    mkcert -cert-file "127.0.0.1+2.pem" -key-file "127.0.0.1+2-key.pem" 127.0.0.1 localhost
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Certificates created in certs/"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. npm run dev:https"
Write-Host "  2. Open https://127.0.0.1:3000"
Write-Host "  3. Register Tuya callback URL: https://127.0.0.1:3000/dashboard/tuya/callback"
