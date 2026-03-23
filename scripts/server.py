#!/usr/bin/env python3
"""
BounceX Static File Server

Serves the web app from the `app/` subdirectory while keeping user data
(videos, playlists, config) in the project root.

URL routing:
  /videos/...     → <root>/videos/...
  /playlists/...  → <root>/playlists/...
  /config.json    → <root>/config.json
  everything else → <root>/app/...

Supports HTTP Range requests so video scrubbing / seeking works correctly.
No external dependencies — uses only the Python standard library.
"""

import json
import mimetypes
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT    = Path(__file__).parent.parent.resolve()   # scripts/ → project root
APP_DIR = ROOT / "app"

_ROOT_PREFIXES = ("/videos/", "/playlists/")
_ROOT_EXACT    = {"/config.json"}

CHUNK = 1024 * 1024  # 1 MB read chunks


def resolve(url_path: str) -> Path:
    p = unquote(url_path.split("?")[0].split("#")[0])
    for prefix in _ROOT_PREFIXES:
        if p.startswith(prefix):
            return ROOT / p.lstrip("/")
    if p in _ROOT_EXACT:
        return ROOT / p.lstrip("/")
    rel = p.lstrip("/") or "index.html"
    return APP_DIR / rel


class BxHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        self._serve(send_body=True)

    def do_HEAD(self):
        self._serve(send_body=False)

    def _serve(self, send_body: bool):
        path = resolve(urlparse(self.path).path)
        if path.is_dir():
            path = path / "index.html"
        if not path.exists() or not path.is_file():
            self._404()
            return
        mime, _ = mimetypes.guess_type(str(path))
        if mime is None:
            mime = "application/octet-stream"
        size = path.stat().st_size
        range_header = self.headers.get("Range")
        if range_header:
            self._serve_range(path, mime, size, range_header, send_body)
        else:
            self._serve_full(path, mime, size, send_body)

    def _serve_full(self, path, mime, size, send_body):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if send_body:
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(CHUNK)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        break

    def _serve_range(self, path, mime, size, header, send_body):
        m = re.match(r"bytes=(\d*)-(\d*)", header)
        if not m:
            self.send_error(416, "Range Not Satisfiable")
            return
        raw_start, raw_end = m.group(1), m.group(2)
        if raw_start == "" and raw_end == "":
            self.send_error(416, "Range Not Satisfiable")
            return
        elif raw_start == "":
            last_n = int(raw_end)
            start, end = max(0, size - last_n), size - 1
        elif raw_end == "":
            start, end = int(raw_start), size - 1
        else:
            start, end = int(raw_start), int(raw_end)
        if start > end or start >= size:
            self.send_error(416, "Range Not Satisfiable")
            return
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not send_body:
            return
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break

    def _404(self):
        body = b"404 Not Found"
        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):
        pass


def run(port: int, bind: str = "0.0.0.0"):
    server = HTTPServer((bind, port), BxHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    config_path = ROOT / "config.json"
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        port = int(cfg.get("httpPort", 8000))
    except Exception:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run(port)
