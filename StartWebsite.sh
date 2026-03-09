#!/bin/bash

echo "===== Starting Server Setup ====="

# Check for Python
if ! command -v python3 &>/dev/null; then
    echo "Python 3 is not installed."
    echo ""

    OS="$(uname -s)"

    if [[ "$OS" == "Darwin" ]]; then
        # Mac
        read -p "Install Python via Homebrew? (y/n): " choice
        if [[ "$choice" == "y" ]]; then
            if ! command -v brew &>/dev/null; then
                echo "Homebrew is not installed. Install it first from https://brew.sh then re-run this script."
                exit 1
            fi
            brew install python3
        else
            echo "Install Python manually from: https://www.python.org/downloads/"
            exit 1
        fi

    elif [[ "$OS" == "Linux" ]]; then
        read -p "Install Python now? (y/n): " choice
        if [[ "$choice" == "y" ]]; then
            if command -v apt &>/dev/null; then
                sudo apt update && sudo apt install -y python3 python3-pip python3-venv
            elif command -v dnf &>/dev/null; then
                sudo dnf install -y python3 python3-pip
            elif command -v pacman &>/dev/null; then
                sudo pacman -Sy python python-pip
            elif command -v zypper &>/dev/null; then
                sudo zypper install -y python3 python3-pip
            else
                echo "Could not detect a package manager. Install Python manually from: https://www.python.org/downloads/"
                exit 1
            fi
        else
            echo "Install Python manually from: https://www.python.org/downloads/"
            exit 1
        fi
    fi

    # Verify install worked
    if ! command -v python3 &>/dev/null; then
        echo "Python still not found after install. Please restart this script."
        exit 1
    fi
    echo "Python installed successfully! Continuing setup..."
    echo ""
fi

# Setup venv
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source ./venv/bin/activate

# Install dependencies if needed
if ! python -c "import RangeHTTPServer" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

python3 bump-sw.py

# Start manager in background
echo "Starting manager in background..."
python3 manager.py &
MANAGER_PID=$!

trap "kill $MANAGER_PID 2>/dev/null" EXIT

# Start main server
echo "Starting HTTP Server on port 8000..."
echo "Press Ctrl+C to stop."
echo ""
python3 -m RangeHTTPServer 8000 --bind 0.0.0.0
