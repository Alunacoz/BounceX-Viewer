#!/bin/bash

# Activate the virtual environment
source ./venv/bin/activate

# Bump Cache Name
python bump-sw.py

# Start the Manager server in the background
python manager.py &
MANAGER_PID=$!

# Kill the manager when this script exits (Ctrl+C or otherwise)
trap "kill $MANAGER_PID 2>/dev/null" EXIT

# Run the main RangeHTTPServer in the foreground
python -m RangeHTTPServer 8000 --bind 0.0.0.0
