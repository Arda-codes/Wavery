# ==============================================================================
# Wavery Windows Builder (.exe NSIS installer & .msi)
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$UiDir = Join-Path $RootDir "ui"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Building Wavery for Windows (x64)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# Verify prerequisites
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed or not in PATH."
    exit 1
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Cargo/Rust is not installed or not in PATH."
    exit 1
}

Write-Host "[1/4] Installing UI dependencies..." -ForegroundColor Yellow
Set-Location $UiDir
npm install

Write-Host "[2/4] Building React/TypeScript frontend..." -ForegroundColor Yellow
npm run build

Write-Host "[3/4] Checking Rust workspace..." -ForegroundColor Yellow
Set-Location $RootDir
cargo check --workspace --all-targets

Write-Host "[4/4] Building Tauri Windows application (NSIS .exe & .msi)..." -ForegroundColor Yellow
Set-Location $UiDir
npx @tauri-apps/cli build

Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  Windows Build Successful!" -ForegroundColor Green
Write-Host "  Output artifacts located in: $RootDir\target\release\bundle\nsis\" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
