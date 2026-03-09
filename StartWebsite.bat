@echo off
setlocal enabledelayedexpansion
echo ===== Starting Server Setup =====

:: Check for Python
python --version > nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not in PATH.
    echo.
    set /p INSTALL_PYTHON="Install Python now via winget? (Y/N): "
    if /i "!INSTALL_PYTHON!"=="Y" (
        echo Installing Python...
        winget install Python.Python.3.13
        if errorlevel 1 (
            echo Install failed. Try installing Python manually at https://www.python.org/downloads/
            echo Make sure to check "Add Python to PATH" during installation!
            pause
            exit /b 1
        )
        echo Refreshing PATH...
        for /f "tokens=*" %%i in ('powershell -command "[System.Environment]::GetEnvironmentVariable(\"PATH\", \"Machine\")"') do set "PATH=%%i;%PATH%"
        python --version > nul 2>&1
        if errorlevel 1 (
            echo Python still not found in PATH after install.
            echo Please close this window and start the script again!
            pause
            exit /b 1
        )
        echo Python installed successfully! Continuing setup...
        echo.
    ) else (
        echo Try installing Python manually at https://www.python.org/downloads/
        echo Make sure to check "Add Python to PATH" during installation!
        pause
        exit /b 1
    )
)

:: Setup venv
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 ( echo Failed to create venv! & pause & exit /b 1 )
)

call .\venv\Scripts\activate.bat
if errorlevel 1 ( echo Failed to activate venv! & pause & exit /b 1 )

:: Install dependencies if needed
python -c "import RangeHTTPServer" 2>nul
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
    if errorlevel 1 ( echo Dependency install failed! & pause & exit /b 1 )
)

python bump-sw.py

:: Start manager hidden in background, grab its PID
echo Starting manager in background...
for /f %%i in ('powershell -command "Start-Process python -ArgumentList 'manager.py' -PassThru -WindowStyle Hidden | Select-Object -ExpandProperty Id"') do set MANAGER_PID=%%i

:: Start main server
echo Starting HTTP Server on port 8000...
echo Press Ctrl+C to stop.
echo.
python -m RangeHTTPServer 8000 --bind 0.0.0.0

:: Cleanup
echo.
echo Stopping manager...
taskkill /pid %MANAGER_PID% /f > nul 2>&1
echo Done.
pause
