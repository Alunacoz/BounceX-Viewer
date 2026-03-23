#!/bin/bash
cd "$(dirname "$0")"

if   [ -f "./venv/bin/python" ]; then PY="./venv/bin/python"
elif command -v python3 &>/dev/null; then PY="python3"
elif command -v python  &>/dev/null; then PY="python"
else echo "Python 3 not found."; exit 1
fi

$PY scripts/update.py
