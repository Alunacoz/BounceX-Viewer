<# :
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~f0"
exit /b
#>

# ==============================================================================
#  BounceX Launcher
#  Starts the HTTP server (port 8000) and Manager (port 8001) together.
#  Ctrl+C cleanly kills both processes before exiting.
# ==============================================================================

Set-Location $PSScriptRoot

function Write-Header {
    Write-Host ""
    Write-Host "  ██████╗  ██████╗ ██╗   ██╗███╗   ██╗ ██████╗███████╗██╗  ██╗" -ForegroundColor Cyan
    Write-Host "  ██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔════╝██╔════╝╚██╗██╔╝" -ForegroundColor Cyan
    Write-Host "  ██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║     █████╗   ╚███╔╝ " -ForegroundColor Cyan
    Write-Host "  ██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║     ██╔══╝   ██╔██╗ " -ForegroundColor Cyan
    Write-Host "  ██████╔╝╚██████╔╝╚██████╔╝██║ ╚████║╚██████╗███████╗██╔╝ ██╗" -ForegroundColor Cyan
    Write-Host "  ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step([string]$msg) {
    Write-Host "  » $msg" -ForegroundColor Yellow
}

function Write-Ok([string]$msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}

function Write-Err([string]$msg) {
    Write-Host "  ✗ $msg" -ForegroundColor Red
}

# ==============================================================================
#  1. Check for Python
# ==============================================================================
Write-Header
Write-Step "Checking for Python..."

$pythonCmd = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3") {
            $pythonCmd = $cmd
            Write-Ok "Found: $ver"
            break
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Err "Python 3 is not installed or not in PATH."
    Write-Host ""
    $answer = Read-Host "  Install Python via winget now? (Y/N)"
    if ($answer -match "^[Yy]") {
        Write-Step "Running: winget install Python.Python.3 ..."
        winget install Python.Python.3 --source winget --silent `
            --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Winget install failed. Please install manually:"
            Write-Host "    https://www.python.org/downloads/" -ForegroundColor Gray
            Write-Host "    (Check 'Add Python to PATH' during setup!)" -ForegroundColor Gray
        } else {
            Write-Ok "Python installed!"
            Write-Host ""
            Write-Host "  Please close this window and run StartWebsite.bat again." -ForegroundColor Cyan
            Write-Host "  (PATH changes take effect in a new terminal session.)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  Please install Python from: https://www.python.org/downloads/" -ForegroundColor Gray
        Write-Host "  (Check 'Add Python to PATH' during setup!)" -ForegroundColor Gray
    }
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}

# ==============================================================================
#  2. Create / activate venv
# ==============================================================================
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Step "Creating virtual environment..."
    & $pythonCmd -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to create virtual environment."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Ok "Virtual environment created."
}

$venvPython = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
$venvPip    = Join-Path $PSScriptRoot "venv\Scripts\pip.exe"

# ==============================================================================
#  3. Install / verify requirements
# ==============================================================================
Write-Step "Checking dependencies..."
$checkOutput = & $venvPython -c "import RangeHTTPServer" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Step "Installing requirements.txt..."
    & $venvPip install -r requirements.txt --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Dependency installation failed."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Ok "Dependencies installed."
} else {
    Write-Ok "Dependencies already satisfied."
}

# ==============================================================================
#  4. Bump service worker
# ==============================================================================
if (Test-Path "bump-sw.py") {
    & $venvPython bump-sw.py 2>$null
}

# ==============================================================================
#  5. Launch both servers — with guaranteed cleanup on exit
# ==============================================================================
Write-Host ""
Write-Host "  ┌─────────────────────────────────────────┐" -ForegroundColor DarkGray
Write-Host "  │  Browse   →  http://localhost:8000      │" -ForegroundColor White
Write-Host "  │  Manager  →  http://localhost:8001      │" -ForegroundColor White
Write-Host "  └─────────────────────────────────────────┘" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C to stop both servers." -ForegroundColor DarkGray
Write-Host ""

$managerProc = $null
$serverProc  = $null

try {
    # Start manager.py in background (hidden window, same venv Python)
    $managerProc = Start-Process `
        -FilePath $venvPython `
        -ArgumentList "manager.py" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru

    Write-Ok "Manager started (PID $($managerProc.Id))"

    # Start HTTP server in background so we can wait on both together
    $serverProc = Start-Process `
        -FilePath $venvPython `
        -ArgumentList "-m", "RangeHTTPServer", "8000", "--bind", "0.0.0.0" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru

    Write-Ok "HTTP server started (PID $($serverProc.Id))"
    Write-Host ""

    # Open browser to the browse page
    Start-Process "http://localhost:8000"

    # Wait until either process exits (or user hits Ctrl+C)
    while ($true) {
        Start-Sleep -Seconds 1

        if ($managerProc.HasExited) {
            Write-Host ""
            Write-Err "Manager stopped unexpectedly (exit code $($managerProc.ExitCode))."
            break
        }
        if ($serverProc.HasExited) {
            Write-Host ""
            Write-Err "HTTP server stopped unexpectedly (exit code $($serverProc.ExitCode))."
            break
        }
    }
}
finally {
    # This block ALWAYS runs — Ctrl+C, window close, or natural exit
    Write-Host ""
    Write-Step "Shutting down..."

    if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        Write-Ok "HTTP server stopped."
    }

    if ($managerProc -and -not $managerProc.HasExited) {
        Stop-Process -Id $managerProc.Id -Force -ErrorAction SilentlyContinue
        Write-Ok "Manager stopped."
    }

    Write-Host ""
}
