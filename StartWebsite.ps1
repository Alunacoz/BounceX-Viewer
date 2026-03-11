# StartWebsite.ps1 — BounceX Viewer server launcher
# Right-click → "Run with PowerShell", or double-click if .ps1 is associated.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "===== BounceX Viewer =====" -ForegroundColor Cyan

# ── Check for Python ─────────────────────────────────────────────────────────
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Python is not installed or not in PATH." -ForegroundColor Yellow
    $answer = Read-Host "Install Python now via winget? (Y/N)"
    if ($answer -match "^[Yy]") {
        Write-Host "Installing Python..."
        winget install Python.Python.3.13 --source winget --silent `
            --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "Install failed. Please install Python manually:" -ForegroundColor Red
            Write-Host "  https://www.python.org/downloads/"
            Write-Host "Make sure to check 'Add Python to PATH' during installation!"
            Read-Host "Press Enter to exit"
            exit 1
        }
        Write-Host ""
        Write-Host "Python installed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "-------------------------------------------------------" -ForegroundColor Cyan
        Write-Host " Please close this window and run StartWebsite.ps1 again" -ForegroundColor Cyan
        Write-Host "-------------------------------------------------------" -ForegroundColor Cyan
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 0
    } else {
        Write-Host "Please install Python manually at https://www.python.org/downloads/"
        Write-Host "Make sure to check 'Add Python to PATH' during installation!"
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ── Venv setup ───────────────────────────────────────────────────────────────
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
    if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create venv!" -ForegroundColor Red; Read-Host; exit 1 }
}

& ".\venv\Scripts\Activate.ps1"
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to activate venv!" -ForegroundColor Red; Read-Host; exit 1 }

# ── Dependencies ─────────────────────────────────────────────────────────────
python -c "import RangeHTTPServer" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing dependencies..."
    pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { Write-Host "Dependency install failed!" -ForegroundColor Red; Read-Host; exit 1 }
}

# ── Bump service worker cache ─────────────────────────────────────────────────
python bump-sw.py

# ── Start manager in background ───────────────────────────────────────────────
Write-Host "Starting manager on port 8001..."
$manager = Start-Process -FilePath python -ArgumentList "manager.py" `
    -PassThru -WindowStyle Hidden

Write-Host "Starting HTTP server on port 8000..."
Write-Host "Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""

# ── Run main server — try/finally guarantees cleanup on any exit ──────────────
try {
    python -m RangeHTTPServer 8000 --bind 0.0.0.0
}
finally {
    Write-Host ""
    Write-Host "Stopping manager (PID $($manager.Id))..."
    if (-not $manager.HasExited) {
        Stop-Process -Id $manager.Id -Force -ErrorAction SilentlyContinue
    }
    # Fallback: kill any orphaned manager.py process
    Get-WmiObject Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*manager.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "Done."
    Read-Host "Press Enter to exit"
}
