#!/bin/bash

# Function to check if running in a terminal
is_terminal() {
    [ -t 1 ] && return 0 || return 1
}

# If not running in terminal, re-launch in one
if ! is_terminal; then
    OS="$(uname -s)"
    
    if [[ "$OS" == "Darwin" ]]; then
        # macOS: Open in Terminal.app
        osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '$(pwd)' && '$(realpath "$0")' ; exit"
end tell
EOF
        exit 0
        
    elif [[ "$OS" == "Linux" ]]; then
        # Linux: Try various terminal emulators
        SCRIPT_PATH="$(realpath "$0")"
        
        # Try terminal emulators in order of preference
        for term in ghostty gnome-terminal xterm konsole terminator alacritty kitty urxvt rxvt st; do
            if command -v "$term" &>/dev/null; then
                case "$term" in
                    gnome-terminal)
                        gnome-terminal -- bash -c "cd '$(pwd)' && '$SCRIPT_PATH' ; exec bash"
                        ;;
                    xterm|konsole|terminator|urxvt|rxvt|st)
                        $term -e bash -c "cd '$(pwd)' && '$SCRIPT_PATH' ; exec bash"
                        ;;
                    alacritty|kitty)
                        $term -e bash -c "cd '$(pwd)' && '$SCRIPT_PATH' ; exec bash"
                        ;;
                esac
                exit 0
            fi
        done
        
        # If no terminal found, show error in dialog
        if command -v zenity &>/dev/null; then
            zenity --error --text="No terminal emulator found. Please run this script from the terminal manually."
        elif command -v kdialog &>/dev/null; then
            kdialog --error "No terminal emulator found. Please run this script from the terminal manually."
        else
            echo "No terminal emulator found. Please run this script from the terminal manually."
            read -p "Press Enter to exit..."
        fi
        exit 1
    fi
fi

# ===== Original script starts here =====
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

# Keep terminal open if script exits unexpectedly
if [ $? -ne 0 ]; then
    echo ""
    echo "Script encountered an error."
    read -p "Press Enter to close this window..."
fi
