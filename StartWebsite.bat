@echo off
setlocal enabledelayedexpansion

echo ===== Starting Server Setup =====

:: Activate the virtual environment
echo Activating virtual environment...
call .\venv\Scripts\activate.bat

:: Check if activation worked
if errorlevel 1 (
    echo Failed to activate virtual environment!
    exit /b 1
)

:: Bump Cache Name
echo Running bump-sw.py...
python bump-sw.py
if errorlevel 1 (
    echo bump-sw.py failed!
    exit /b 1
)

:: Start the Manager server in a new window
echo Starting manager.py in new window...
start "Manager Server" cmd /c "call .\venv\Scripts\activate.bat && python manager.py && echo Manager terminated - Press any key... && pause > nul"

:: Give the manager a moment to start
timeout /t 2 /nobreak > nul

:: Run the main RangeHTTPServer
echo Starting HTTP Server on port 8000...
echo Press Ctrl+C to stop the server and exit
echo.
python -m RangeHTTPServer 8000 --bind 0.0.0.0

:: When HTTP server stops, remind user to close manager
echo.
echo HTTP Server stopped.
echo Please close the Manager Server window manually.
pause
