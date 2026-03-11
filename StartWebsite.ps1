# BounceX Launcher
# Right-click -> "Run with PowerShell" or double-click if .ps1 is associated.

Set-Location $PSScriptRoot

# ── Helpers ────────────────────────────────────────────────────────────────────
function Step  { param($m) Write-Host "  >> $m" -ForegroundColor Yellow }
function Ok    { param($m) Write-Host "  OK $m" -ForegroundColor Green }
function Fail  { param($m) Write-Host "  !! $m" -ForegroundColor Red }

# ── Header ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  BounceX Launcher" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Find Python ─────────────────────────────────────────────────────────────
Step "Checking for Python 3..."

$pythonCmd = $null
foreach ($candidate in @("python", "python3")) {
    $result = & $candidate --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $result -match "Python 3") {
        $pythonCmd = $candidate
        Ok "Found: $result"
        break
    }
}

if (-not $pythonCmd) {
    Fail "Python 3 not found."
    Write-Host ""
    $ans = Read-Host "  Install Python via winget? (Y/N)"
    if ($ans -match "^[Yy]") {
        Step "Running winget..."
        winget install Python.Python.3.13 --source winget --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Ok "Python installed."
            Write-Host ""
            Write-Host "  Please close this window and run the script again." -ForegroundColor Cyan
            Write-Host "  (PATH changes only take effect in a new session.)" -ForegroundColor DarkGray
        } else {
            Fail "Winget failed. Install manually: https://www.python.org/downloads/"
            Write-Host "  Make sure to check 'Add Python to PATH' during setup." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  Install manually: https://www.python.org/downloads/" -ForegroundColor DarkGray
        Write-Host "  Make sure to check 'Add Python to PATH' during setup." -ForegroundColor DarkGray
    }
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}

# ── 2. Create venv if missing ──────────────────────────────────────────────────
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Step "Creating virtual environment..."
    & $pythonCmd -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to create venv."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Ok "Virtual environment created."
}

$py  = "$PSScriptRoot\venv\Scripts\python.exe"
$pip = "$PSScriptRoot\venv\Scripts\pip.exe"

# ── 3. Install requirements if needed ─────────────────────────────────────────
Step "Checking dependencies..."
& $py -c "import RangeHTTPServer" 2>$null
if ($LASTEXITCODE -ne 0) {
    Step "Installing requirements.txt..."
    & $pip install -r requirements.txt --quiet
    if ($LASTEXITCODE -ne 0) {
        Fail "Dependency install failed."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Ok "Dependencies installed."
} else {
    Ok "Dependencies already satisfied."
}

# ── 4. Bump service worker ─────────────────────────────────────────────────────
if (Test-Path "bump-sw.py") {
    & $py bump-sw.py 2>$null
}

# ── 5. Launch servers ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Browse   ->  http://localhost:8000" -ForegroundColor White
Write-Host "  Manager  ->  http://localhost:8001" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop both servers." -ForegroundColor DarkGray
Write-Host ""

$managerProc = $null
$serverProc  = $null

try {
    $managerProc = Start-Process -FilePath $py `
        -ArgumentList "manager.py" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru
    Ok "Manager started (PID $($managerProc.Id))"

    $serverProc = Start-Process -FilePath $py `
        -ArgumentList "-m", "RangeHTTPServer", "8000", "--bind", "0.0.0.0" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru
    Ok "HTTP server started (PID $($serverProc.Id))"

    Start-Process "http://localhost:8000"

    # Block here until Ctrl+C or a process dies
    while ($true) {
        Start-Sleep -Seconds 1
        if ($managerProc.HasExited) {
            Fail "Manager exited unexpectedly (code $($managerProc.ExitCode))."
            break
        }
        if ($serverProc.HasExited) {
            Fail "HTTP server exited unexpectedly (code $($serverProc.ExitCode))."
            break
        }
    }
} finally {
    # Runs on Ctrl+C, window close, or natural exit — always
    Write-Host ""
    Step "Shutting down..."

    if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        Ok "HTTP server stopped."
    }
    if ($managerProc -and -not $managerProc.HasExited) {
        Stop-Process -Id $managerProc.Id -Force -ErrorAction SilentlyContinue
        Ok "Manager stopped."
    }

    Write-Host ""
    Read-Host "  Press Enter to exit"
}
