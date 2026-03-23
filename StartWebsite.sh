#!/bin/bash

echo "===== Starting Server Setup ====="

if ! command -v python3 &>/dev/null; then
    echo "Python 3 is not installed."
    OS="$(uname -s)"
    if [[ "$OS" == "Darwin" ]]; then
        read -p "Install Python via Homebrew? (y/n): " choice
        if [[ "$choice" == "y" ]]; then
            if ! command -v brew &>/dev/null; then
                echo "Homebrew not found. Install from https://brew.sh then re-run."
                exit 1
            fi
            brew install python3
        else
            echo "Install from: https://www.python.org/downloads/"; exit 1
        fi
    elif [[ "$OS" == "Linux" ]]; then
        read -p "Install Python now? (y/n): " choice
        if [[ "$choice" == "y" ]]; then
            if   command -v apt    &>/dev/null; then sudo apt update && sudo apt install -y python3 python3-venv
            elif command -v dnf    &>/dev/null; then sudo dnf install -y python3
            elif command -v pacman &>/dev/null; then sudo pacman -Sy python
            elif command -v zypper &>/dev/null; then sudo zypper install -y python3
            else echo "No package manager found. Install from: https://www.python.org/downloads/"; exit 1
            fi
        else
            echo "Install from: https://www.python.org/downloads/"; exit 1
        fi
    fi
    if ! command -v python3 &>/dev/null; then
        echo "Python still not found. Please restart this script."; exit 1
    fi
fi

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source ./venv/bin/activate

python3 scripts/bump-sw.py

HTTP_PORT=$(python3 -c "import json; print(json.load(open('config.json'))['httpPort'])")
MANAGER_PORT=$(python3 -c "import json; print(json.load(open('config.json'))['managerPort'])")

LOCAL_IP=""
if command -v ip &>/dev/null; then
    LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{print $7; exit}')
fi
if [[ -z "$LOCAL_IP" ]] && command -v ipconfig &>/dev/null; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null)
fi
if [[ -z "$LOCAL_IP" ]]; then LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}'); fi
if [[ -z "$LOCAL_IP" ]]; then LOCAL_IP="localhost"; fi

python3 scripts/manager.py &
MANAGER_PID=$!
trap "kill $MANAGER_PID 2>/dev/null" EXIT

echo "  On your local network, open this URL on any device:"
echo "  Home page  ->  http://$LOCAL_IP:$HTTP_PORT"
echo ""
echo "Press Ctrl+C to stop."
echo ""
python3 scripts/server.py
