# BounceX Viewer — Updater
# Double-click or: powershell -ExecutionPolicy Bypass -File Update.ps1

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  BounceX Viewer — Updater" -ForegroundColor Cyan
Write-Host ""

# Find Python
$py = $null
foreach ($cmd in @("python", "python3")) {
    $v = & $cmd --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $v -match "Python 3") { $py = $cmd; break }
}

# Try venv Python first (already has all deps)
if (Test-Path "$PSScriptRoot\venv\Scripts\python.exe") {
    $py = "$PSScriptRoot\venv\Scripts\python.exe"
}

if (-not $py) {
    Write-Host "  Python 3 not found. Install it from https://www.python.org/" -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}

& $py update.py

Write-Host ""
