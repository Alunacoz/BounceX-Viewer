#!/bin/bash
# BounceX Viewer — Updater

cd "$(dirname "$0")"

# Use venv Python if available
if [ -f "./venv/bin/python" ]; then
    PY="./venv/bin/python"
elif command -v python3 &>/dev/null; then
    PY="python3"
elif command -v python &>/dev/null; then
    PY="python"
else
    echo "Python 3 not found. Install it from https://www.python.org/"
    exit 1
fi

$PY update.py
