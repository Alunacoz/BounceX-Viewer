#!/usr/bin/env python3
"""
BounceX Viewer Updater

How it works:
  1. If git is installed and this is a git repo → runs `git pull`
  2. Otherwise → downloads the latest ZIP from GitHub and extracts it,
     preserving your local user data (videos, playlists, config, venv).

Run directly:  python update.py
Or use the launcher:  Update.bat / Update.sh
"""

import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT        = Path(__file__).parent.parent.resolve()   # scripts/ → project root
GITHUB_REPO = "Alunacoz/BounceX-Viewer"
BRANCH      = "main"
ZIP_URL     = f"https://github.com/{GITHUB_REPO}/archive/refs/heads/{BRANCH}.zip"

# These paths belong to the user and are never touched by the updater.
PRESERVE = {
    "videos",
    "playlists",
    "config.json",
    "venv",
    ".git",
    "scripts",     # don't overwrite the scripts dir mid-run (update.py lives here)
    "Update.bat",
    "Update.ps1",
    "Update.sh",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def heading(text):
    print()
    print(f"  {text}")
    print(f"  {'─' * len(text)}")

def ok(text):   print(f"  ✓  {text}")
def info(text): print(f"     {text}")
def fail(text): print(f"  ✗  {text}")


# ── Strategy 1: git pull ──────────────────────────────────────────────────────

def try_git_pull():
    """Return True if this is a git repo and git pull succeeded."""
    # Is git available?
    try:
        subprocess.run(["git", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        info("git not found — skipping git strategy.")
        return False

    # Is this a git repo?
    result = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        info("Not a git repository — skipping git strategy.")
        return False

    info("git found. Running git pull...")
    result = subprocess.run(
        ["git", "pull"],
        cwd=ROOT, capture_output=False, text=True,
    )
    if result.returncode == 0:
        ok("git pull completed.")
        return True

    fail(f"git pull exited with code {result.returncode}.")
    return False


# ── Strategy 2: ZIP download ──────────────────────────────────────────────────

def zip_update():
    """Download the latest ZIP from GitHub and extract it."""
    info(f"Downloading {GITHUB_REPO} @ {BRANCH} ...")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, "update.zip")

            # Download with a progress indicator
            def reporthook(block, block_size, total):
                if total > 0:
                    pct = min(100, block * block_size * 100 // total)
                    print(f"\r     {pct}%", end="", flush=True)

            urllib.request.urlretrieve(ZIP_URL, zip_path, reporthook)
            print()  # newline after progress

            info("Extracting...")
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(tmp)

            # GitHub ZIPs have one top-level folder, e.g. "BounceX-Viewer-main/"
            extracted_dirs = [
                d for d in Path(tmp).iterdir()
                if d.is_dir() and d.name != "__MACOSX"
            ]
            if not extracted_dirs:
                fail("ZIP contained no directory — aborting.")
                return False
            src = extracted_dirs[0]

            # Copy everything except preserved paths
            updated = []
            for item in src.iterdir():
                if item.name in PRESERVE:
                    continue
                dest = ROOT / item.name
                if item.is_dir():
                    if dest.exists():
                        shutil.rmtree(dest)
                    shutil.copytree(item, dest)
                else:
                    shutil.copy2(item, dest)
                updated.append(item.name)

            ok(f"Updated {len(updated)} item(s): {', '.join(sorted(updated))}")
            return True

    except urllib.error.URLError as e:
        fail(f"Download failed: {e.reason}")
    except zipfile.BadZipFile:
        fail("Downloaded file is not a valid ZIP.")
    except Exception as e:
        fail(f"Unexpected error: {e}")
    return False


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print()
    print("  BounceX Viewer — Updater")
    print("  " + "═" * 28)

    heading("Checking for updates")

    if try_git_pull():
        print()
        print("  Update complete.")
        if len(sys.argv) < 2 or sys.argv[1] != "--no-pause":
            input("\n  Press Enter to exit...")
        sys.exit(0)

    info("Falling back to ZIP download...")
    if zip_update():
        print()
        print("  Update complete.")
        if len(sys.argv) < 2 or sys.argv[1] != "--no-pause":
            input("\n  Press Enter to exit...")
        sys.exit(0)

    print()
    fail("Update failed. Check your internet connection and try again.")
    if len(sys.argv) < 2 or sys.argv[1] != "--no-pause":
        input("\n  Press Enter to exit...")
    sys.exit(1)
