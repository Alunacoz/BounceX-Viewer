# BounceX Launcher
# Right-click -> "Run with PowerShell" or double-click if .ps1 is associated.

Set-Location $PSScriptRoot

function Step  { param($m) Write-Host "  >> $m" -ForegroundColor Yellow }
function Ok    { param($m) Write-Host "  OK $m" -ForegroundColor Green }
function Fail  { param($m) Write-Host "  !! $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  BounceX Launcher" -ForegroundColor Cyan
Write-Host ""

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

$py = "$PSScriptRoot\venv\Scripts\python.exe"

if (Test-Path "scripts\bump-sw.py") {
    & $py scripts\bump-sw.py 2>$null
}

$configRaw = Get-Content "config.json" -Raw | ConvertFrom-Json
$httpPort = $configRaw.httpPort
$managerPort = $configRaw.managerPort

$localIP = $null
try {
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Sort-Object PrefixLength |
        Select-Object -First 1).IPAddress
} catch { }
if (-not $localIP) { $localIP = "localhost" }

Write-Host ""
Write-Host "  On your local network, open this URL on any device:" -ForegroundColor Cyan
Write-Host "  Home page  ->  http://${localIP}:$httpPort" -ForegroundColor Green
Write-Host ""
Write-Host "  Press Ctrl+C to stop both servers." -ForegroundColor DarkGray
Write-Host ""

$managerProc = $null
$serverProc  = $null

try {
    $managerProc = Start-Process -FilePath $py `
        -ArgumentList "scripts\manager.py" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru
    Ok "Manager started (PID $($managerProc.Id))"

    $serverProc = Start-Process -FilePath $py `
        -ArgumentList "scripts\server.py" `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru
    Ok "HTTP server started (PID $($serverProc.Id))"

    Start-Process "http://localhost:$httpPort"

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
