@echo off
setlocal enabledelayedexpansion
echo ===== Starting Server Setup =====

if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 ( echo Failed to create venv! & pause & exit /b 1 )
)

call .\venv\Scripts\activate.bat
if errorlevel 1 ( echo Failed to activate venv! & pause & exit /b 1 )

python -c "import RangeHTTPServer" 2>nul
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
    if errorlevel 1 ( echo Dependency install failed! & pause & exit /b 1 )
)

python bump-sw.py

echo Starting manager in background...
for /f %%i in ('powershell -command "Start-Process python -ArgumentList 'manager.py' -PassThru -WindowStyle Hidden | Select-Object -ExpandProperty Id"') do set MANAGER_PID=%%i

echo Starting HTTP Server on port 8000...
echo Press Ctrl+C to stop.
echo.
python -m RangeHTTPServer 8000 --bind 0.0.0.0

echo.
echo Stopping manager...
taskkill /pid %MANAGER_PID% /f > nul 2>&1
echo Done.
pause
