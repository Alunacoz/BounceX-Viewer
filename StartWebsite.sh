#!/bin/bash

# Check if python is installed
if ! command -v python3 &>/dev/null; then
    echo "Python 3 is not installed."
    echo "Install it from: https://www.python.org/downloads/"
    echo "Or on Mac, run: brew install python"
    exit 1
fi

# --- Setup (only runs if needed) ---
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source ./venv/bin/activate

# Check if dependencies are installed by testing a key package
if ! python -c "import RangeHTTPServer" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

# --- Start ---
python bump-sw.py
python manager.py &
MANAGER_PID=$!
trap "kill $MANAGER_PID 2>/dev/null" EXIT
python -m RangeHTTPServer 8000 --bind 0.0.0.0
