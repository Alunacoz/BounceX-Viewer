#!/usr/bin/env python3
"""
download-buttplug.py — Run this ONCE to download buttplug.js for local use.

Usage:
    python3 download-buttplug.py

Places buttplug.js in the same directory as this script (your project root),
so it's served by RangeHTTPServer alongside your other files.
"""

import urllib.request
import sys
import os

# Check https://www.npmjs.com/package/buttplug for the latest version
# and update this if needed.
VERSION = "3.2.2"
URL = f"https://cdn.jsdelivr.net/npm/buttplug@{VERSION}/dist/web/buttplug.min.js"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "buttplug.js")

if os.path.exists(OUT):
    print(f"✓ buttplug.js already exists — delete it first to re-download.")
    sys.exit(0)

print(f"Downloading buttplug.js v{VERSION}…")
try:
    urllib.request.urlretrieve(URL, OUT)
    size = os.path.getsize(OUT)
    print(f"✓ Saved to buttplug.js ({size // 1024} KB)")
    print(f"  You only need to do this once. Run StartWebsite.sh to start serving.")
except Exception as e:
    print(f"✗ Download failed: {e}")
    print(f"  Try downloading manually from:\n  {URL}")
    print(f"  and save it as 'buttplug.js' in your project folder.")
    sys.exit(1)
