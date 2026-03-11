#!/usr/bin/env python3
"""
BounceX Manager Server
Run with:  python manager.py
Opens http://localhost:8001/manager.html automatically.
"""

import io
import json
import re
import shutil
import sys
import tempfile
import zipfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

PORT = 8001
ROOT = Path(__file__).parent.resolve()
VIDEO_BASE = ROOT / "videos"
PLAYLIST_BASE = ROOT / "playlists"
MANAGER_URL = f"http://localhost:{PORT}/manager.html"

# Increments on every write operation so the main site can detect changes
_version = 0

def bump_version():
    global _version
    _version += 1


# ── JSON helpers ───────────────────────────────────────────────────────────────

def read_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _synthesize_meta(folder_id: str, folder: Path) -> dict:
    """
    Build a minimal meta dict by scanning the folder when meta.json is absent.
    Tries common naming conventions (folder-name.mp4 / .bx / thumb.jpg).
    """
    meta: dict = {"title": folder_id}

    # Video file — try <folder>.mp4 then any .mp4 / .webm in the dir
    for ext in (".mp4", ".webm", ".mkv", ".mov"):
        if (folder / (folder_id + ext)).exists():
            meta["videoFile"] = folder_id + ext
            break
    if "videoFile" not in meta:
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov"):
                meta["videoFile"] = f.name
                break

    # BX file — try <folder>.bx then any .bx in the dir
    bx_name = None
    if (folder / (folder_id + ".bx")).exists():
        bx_name = folder_id + ".bx"
    else:
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() == ".bx":
                bx_name = f.name
                break
    if bx_name:
        meta["bxFiles"] = [{"label": "Default", "file": bx_name}]

    # Thumbnail
    for thumb in ("thumb.jpg", "thumb.png", folder_id + ".jpg", folder_id + ".png"):
        if (folder / thumb).exists():
            meta["thumbnail"] = thumb
            break

    return meta


# ── API: list videos ───────────────────────────────────────────────────────────

def api_videos():
    manifest_path = VIDEO_BASE / "manifest.json"
    if not manifest_path.exists():
        return {"error": "videos/manifest.json not found"}, 404
    manifest = read_json(manifest_path)
    results = []
    for folder_id in manifest:
        folder = VIDEO_BASE / folder_id
        meta_path = folder / "meta.json"
        errors = []
        warnings = []

        if not meta_path.exists():
            # meta.json is optional — synthesise from folder contents instead
            if not folder.exists():
                errors.append("video folder missing")
                results.append({"_folder": folder_id, "_errors": errors, "_warnings": warnings})
                continue
            meta = _synthesize_meta(folder_id, folder)
            meta["_folder"] = folder_id
            meta["_synthesized"] = True
            warnings.append("meta.json missing")
        else:
            try:
                meta = read_json(meta_path)
            except Exception as e:
                errors.append(f"meta.json unreadable: {e}")
                results.append({"_folder": folder_id, "_errors": errors, "_warnings": warnings})
                continue
            meta["_folder"] = folder_id

        # Video file — normalise missing to <folder>.mp4 by convention
        if not meta.get("videoFile"):
            meta["videoFile"] = folder_id + ".mp4"
        video_file = meta["videoFile"]
        if not (folder / video_file).exists():
            warnings.append(f"video file missing: {video_file}")

        # Required: bx path file — normalise legacy bxFile so only bxFiles is checked
        if not meta.get("bxFiles") and meta.get("bxFile"):
            meta["bxFiles"] = [{"label": "Default", "file": meta["bxFile"]}]

        bx_files = meta.get("bxFiles")
        if bx_files and isinstance(bx_files, list) and len(bx_files) > 0:
            bx_ref = bx_files[0].get("file") if isinstance(bx_files[0], dict) else None
            if not bx_ref:
                errors.append("bxFiles[0].file not set in meta.json")
            elif not (folder / bx_ref).exists():
                errors.append(f"bx file missing: {bx_ref}")
        else:
            errors.append("no bxFiles set in meta.json")

        # Optional: thumbnail
        thumbnail = meta.get("thumbnail")
        if not thumbnail:
            warnings.append("no thumbnail set")
        elif not (folder / thumbnail).exists():
            warnings.append(f"thumbnail missing: {thumbnail}")

        meta["_errors"]   = errors
        meta["_warnings"] = warnings
        results.append(meta)
    return results, 200


# ── API: list playlists ────────────────────────────────────────────────────────

def api_playlists():
    manifest_path = PLAYLIST_BASE / "manifest.json"
    if not manifest_path.exists():
        return {"error": "playlists/manifest.json not found"}, 404
    manifest = read_json(manifest_path)
    results = []
    for pl_id in manifest:
        folder = PLAYLIST_BASE / pl_id
        pl_path = folder / "meta.json"
        errors = []
        warnings = []

        if not pl_path.exists():
            errors.append("meta.json missing")
            results.append({"_id": pl_id, "_errors": errors, "_warnings": warnings})
            continue

        try:
            data = read_json(pl_path)
        except Exception as e:
            errors.append(f"meta.json unreadable: {e}")
            results.append({"_id": pl_id, "_errors": errors, "_warnings": warnings})
            continue

        data["_id"] = pl_id

        # Optional: thumbnail
        thumbnail = data.get("thumbnail")
        if not thumbnail:
            warnings.append("no thumbnail set")
        elif not (folder / thumbnail).exists():
            warnings.append(f"thumbnail missing: {thumbnail}")

        data["_errors"]   = errors
        data["_warnings"] = warnings
        results.append(data)
    return results, 200


# ── API: import zip ────────────────────────────────────────────────────────────

def api_import(handler):
    content_length = int(handler.headers.get("Content-Length", 0))

    if content_length == 0:
        return {"error": "Empty request body"}, 400

    zip_bytes = handler.rfile.read(content_length)

    if not zipfile.is_zipfile(io.BytesIO(zip_bytes)):
        return {"error": "Uploaded file is not a valid zip archive"}, 400

    added_videos = []
    added_playlists = []
    skipped = []

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmp_path)

        # ── Collect candidate folders from the zip ──────────────────────────
        # Support both flat layout (videos/Foo/) and a single top-level wrapper
        # (MyPack/videos/Foo/).  We just search for any directory named
        # "videos" or "playlists" anywhere in the extracted tree.

        def find_section_dirs(section: str) -> list[Path]:
            """Return all direct-child folders inside every '<section>/' dir found."""
            results = []
            for section_dir in tmp_path.rglob(section):
                if section_dir.is_dir():
                    results.extend(
                        p for p in section_dir.iterdir() if p.is_dir()
                    )
            return results

        # ── Videos ─────────────────────────────────────────────────────────
        video_manifest_path = VIDEO_BASE / "manifest.json"
        if video_manifest_path.exists():
            video_manifest = read_json(video_manifest_path)
        else:
            VIDEO_BASE.mkdir(parents=True, exist_ok=True)
            video_manifest = []

        for src_folder in find_section_dirs("videos"):
            folder_id = src_folder.name
            dest = VIDEO_BASE / folder_id
            if folder_id in video_manifest:
                skipped.append({"id": folder_id, "type": "video", "reason": "already in manifest"})
                continue
            if dest.exists():
                skipped.append({"id": folder_id, "type": "video", "reason": "folder already exists"})
                continue
            shutil.copytree(src_folder, dest)
            added_videos.append(folder_id)

        if added_videos:
            new_manifest = added_videos + video_manifest
            write_json(video_manifest_path, new_manifest)
            bump_version()

        # ── Playlists ───────────────────────────────────────────────────────
        playlist_manifest_path = PLAYLIST_BASE / "manifest.json"
        if playlist_manifest_path.exists():
            playlist_manifest = read_json(playlist_manifest_path)
        else:
            PLAYLIST_BASE.mkdir(parents=True, exist_ok=True)
            playlist_manifest = []

        for src_folder in find_section_dirs("playlists"):
            folder_id = src_folder.name
            dest = PLAYLIST_BASE / folder_id
            if folder_id in playlist_manifest:
                skipped.append({"id": folder_id, "type": "playlist", "reason": "already in manifest"})
                continue
            if dest.exists():
                skipped.append({"id": folder_id, "type": "playlist", "reason": "folder already exists"})
                continue
            shutil.copytree(src_folder, dest)
            added_playlists.append(folder_id)

        if added_playlists:
            new_manifest = added_playlists + playlist_manifest
            write_json(playlist_manifest_path, new_manifest)
            bump_version()

    return {
        "added_videos": added_videos,
        "added_playlists": added_playlists,
        "skipped": skipped,
    }, 200


# ── API: delete video ──────────────────────────────────────────────────────────

def api_delete_video(folder_id: str):
    if not folder_id or "/" in folder_id or "\\" in folder_id or folder_id in (".", ".."):
        return {"error": "Invalid folder id"}, 400

    manifest_path = VIDEO_BASE / "manifest.json"
    if not manifest_path.exists():
        return {"error": "videos/manifest.json not found"}, 404

    manifest = read_json(manifest_path)
    if folder_id not in manifest:
        return {"error": f'"{folder_id}" not found in manifest'}, 404

    folder_path = VIDEO_BASE / folder_id
    if folder_path.exists():
        shutil.rmtree(folder_path)

    manifest.remove(folder_id)
    write_json(manifest_path, manifest)
    bump_version()
    return {"deleted": folder_id, "type": "video"}, 200


# ── API: delete playlist ───────────────────────────────────────────────────────

def api_delete_playlist(folder_id: str):
    if not folder_id or "/" in folder_id or "\\" in folder_id or folder_id in (".", ".."):
        return {"error": "Invalid folder id"}, 400

    manifest_path = PLAYLIST_BASE / "manifest.json"
    if not manifest_path.exists():
        return {"error": "playlists/manifest.json not found"}, 404

    manifest = read_json(manifest_path)
    if folder_id not in manifest:
        return {"error": f'"{folder_id}" not found in manifest'}, 404

    folder_path = PLAYLIST_BASE / folder_id
    if folder_path.exists():
        shutil.rmtree(folder_path)

    manifest.remove(folder_id)
    write_json(manifest_path, manifest)
    bump_version()
    return {"deleted": folder_id, "type": "playlist"}, 200


# ── API: read meta ─────────────────────────────────────────────────────────────

def api_read_meta(section: str, folder_id: str):
    if not folder_id or "/" in folder_id or "\\" in folder_id or folder_id in (".", ".."):
        return {"error": "Invalid folder id"}, 400
    base = VIDEO_BASE if section == "videos" else PLAYLIST_BASE
    meta_path = base / folder_id / "meta.json"
    if not meta_path.exists():
        return {"error": f"meta.json not found for {folder_id}"}, 404
    try:
        data = read_json(meta_path)
        return data, 200
    except Exception as e:
        return {"error": str(e)}, 500


# ── API: write meta ────────────────────────────────────────────────────────────

def api_write_meta(handler, section: str, folder_id: str):
    if not folder_id or "/" in folder_id or "\\" in folder_id or folder_id in (".", ".."):
        return {"error": "Invalid folder id"}, 400
    base = VIDEO_BASE if section == "videos" else PLAYLIST_BASE
    folder_path = base / folder_id
    meta_path = folder_path / "meta.json"
    if not folder_path.exists():
        return {"error": f'Folder not found for {folder_id}'}, 404

    content_length = int(handler.headers.get("Content-Length", 0))
    if content_length == 0:
        return {"error": "Empty request body"}, 400

    raw = handler.rfile.read(content_length)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}, 400

    write_json(meta_path, data)
    bump_version()
    return {"saved": folder_id}, 200


# ── API: reorder manifest ──────────────────────────────────────────────────────

def api_reorder(handler, section: str):
    base = VIDEO_BASE if section == "videos" else PLAYLIST_BASE
    manifest_path = base / "manifest.json"
    if not manifest_path.exists():
        return {"error": f"{section}/manifest.json not found"}, 404

    content_length = int(handler.headers.get("Content-Length", 0))
    if content_length == 0:
        return {"error": "Empty request body"}, 400

    raw = handler.rfile.read(content_length)
    try:
        new_order = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}, 400

    if not isinstance(new_order, list) or not all(isinstance(x, str) for x in new_order):
        return {"error": "Expected a JSON array of strings"}, 400

    # Verify every entry exists in the current manifest (no injections)
    current = read_json(manifest_path)
    current_set = set(current)
    if set(new_order) != current_set:
        return {"error": "Reordered list must contain the same entries as the current manifest"}, 400

    write_json(manifest_path, new_order)
    bump_version()
    return {"reordered": section, "count": len(new_order)}, 200


# ── Multipart form parser ──────────────────────────────────────────────────────

def parse_multipart_form(handler):
    """
    Parse multipart/form-data from an HTTP request.
    Returns (fields, files) where:
      fields = {name: str_value}
      files  = {name: (original_filename, bytes)}
    Handles multiple files with the same name by using name_0, name_1 etc.
    """
    ct = handler.headers.get('Content-Type', '')
    m = re.search(r'boundary=([^\s;]+)', ct)
    if not m:
        raise ValueError("No boundary in Content-Type")

    boundary = m.group(1).strip('"\'')
    boundary_bytes = ('--' + boundary).encode('latin-1')

    content_length = int(handler.headers.get('Content-Length', 0))
    body = handler.rfile.read(content_length)

    fields = {}
    files = {}

    parts = body.split(boundary_bytes)
    for part in parts[1:]:
        if part.lstrip(b'\r\n').startswith(b'--'):
            break
        if part.startswith(b'\r\n'):
            part = part[2:]
        elif part.startswith(b'\n'):
            part = part[1:]

        if b'\r\n\r\n' in part:
            header_raw, body_part = part.split(b'\r\n\r\n', 1)
        elif b'\n\n' in part:
            header_raw, body_part = part.split(b'\n\n', 1)
        else:
            continue

        if body_part.endswith(b'\r\n'):
            body_part = body_part[:-2]
        elif body_part.endswith(b'\n'):
            body_part = body_part[:-1]

        header_str = header_raw.decode('utf-8', errors='replace')
        name_m = re.search(r'name="([^"]*)"', header_str, re.IGNORECASE)
        fname_m = re.search(r'filename="([^"]*)"', header_str, re.IGNORECASE)
        if not name_m:
            continue

        name = name_m.group(1)
        if fname_m:
            filename = fname_m.group(1)
            files[name] = (filename, body_part)
        else:
            fields[name] = body_part.decode('utf-8', errors='replace')

    return fields, files


# ── API: create video package ──────────────────────────────────────────────────

def api_create_video(handler):
    ct = handler.headers.get('Content-Type', '')
    if 'multipart/form-data' not in ct:
        return {"error": "Expected multipart/form-data"}, 400

    try:
        fields, files = parse_multipart_form(handler)
    except Exception as e:
        return {"error": f"Failed to parse form data: {e}"}, 400

    # ── Validate folder ID ──────────────────────────────────────────────────
    folder_id = fields.get('folderId', '').strip()
    if not folder_id:
        return {"error": "folderId is required"}, 400
    if '/' in folder_id or '\\' in folder_id or folder_id in ('.', '..'):
        return {"error": "Invalid folder ID"}, 400

    folder_path = VIDEO_BASE / folder_id
    if folder_path.exists():
        return {"error": f'Folder "{folder_id}" already exists'}, 409

    # ── Validate video file ─────────────────────────────────────────────────
    if 'video' not in files:
        return {"error": "Video file is required"}, 400
    video_filename, video_bytes = files['video']
    if not video_filename:
        return {"error": "Video file has no name"}, 400

    # ── Parse meta ──────────────────────────────────────────────────────────
    try:
        meta = json.loads(fields.get('meta', '{}'))
    except json.JSONDecodeError as e:
        return {"error": f"Invalid meta JSON: {e}"}, 400

    # ── Build the package ───────────────────────────────────────────────────
    folder_path.mkdir(parents=True, exist_ok=False)
    try:
        # Video
        with open(folder_path / video_filename, 'wb') as f:
            f.write(video_bytes)
        meta['videoFile'] = video_filename

        # Thumbnail (optional)
        if 'thumbnail' in files:
            thumb_filename, thumb_bytes = files['thumbnail']
            if thumb_filename and thumb_bytes:
                with open(folder_path / thumb_filename, 'wb') as f:
                    f.write(thumb_bytes)
                meta['thumbnail'] = thumb_filename

        # BX files — sent as bx_0, bx_1, …
        bx_files_meta = []
        idx = 0
        while f'bx_{idx}' in files:
            bx_filename, bx_bytes = files[f'bx_{idx}']
            label = fields.get(f'bxLabel_{idx}', 'Default')
            if bx_filename and bx_bytes:
                with open(folder_path / bx_filename, 'wb') as f:
                    f.write(bx_bytes)
                bx_files_meta.append({"label": label, "file": bx_filename})
            idx += 1
        if bx_files_meta:
            meta['bxFiles'] = bx_files_meta

        # Write meta.json
        write_json(folder_path / 'meta.json', meta)

        # Update manifest (prepend so it shows first)
        manifest_path = VIDEO_BASE / 'manifest.json'
        if manifest_path.exists():
            manifest = read_json(manifest_path)
        else:
            VIDEO_BASE.mkdir(parents=True, exist_ok=True)
            manifest = []
        manifest.insert(0, folder_id)
        write_json(manifest_path, manifest)

        bump_version()
        return {"created": folder_id}, 200

    except Exception as e:
        if folder_path.exists():
            shutil.rmtree(folder_path)
        return {"error": f"Failed to create package: {e}"}, 500


# ── HTTP handler ───────────────────────────────────────────────────────────────

class ManagerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path == "/manager-api/version":
            self._send_json({"version": _version})
        elif path == "/manager-api/videos":
            self._send_json(*api_videos())
        elif path == "/manager-api/playlists":
            self._send_json(*api_playlists())
        elif path.startswith("/manager-api/videos/") and path.endswith("/meta"):
            folder_id = unquote(path[len("/manager-api/videos/"):-len("/meta")])
            self._send_json(*api_read_meta("videos", folder_id))
        elif path.startswith("/manager-api/playlists/") and path.endswith("/meta"):
            folder_id = unquote(path[len("/manager-api/playlists/"):-len("/meta")])
            self._send_json(*api_read_meta("playlists", folder_id))
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        if path == "/manager-api/import":
            try:
                self._send_json(*api_import(self))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path == "/manager-api/videos/create":
            try:
                self._send_json(*api_create_video(self))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path == "/manager-api/videos/reorder":
            try:
                self._send_json(*api_reorder(self, "videos"))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path == "/manager-api/playlists/reorder":
            try:
                self._send_json(*api_reorder(self, "playlists"))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path.startswith("/manager-api/videos/") and path.endswith("/meta"):
            folder_id = unquote(path[len("/manager-api/videos/"):-len("/meta")])
            try:
                self._send_json(*api_write_meta(self, "videos", folder_id))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path.startswith("/manager-api/playlists/") and path.endswith("/meta"):
            folder_id = unquote(path[len("/manager-api/playlists/"):-len("/meta")])
            try:
                self._send_json(*api_write_meta(self, "playlists", folder_id))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        else:
            self.send_error(404)

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path.startswith("/manager-api/videos/"):
                folder_id = unquote(path[len("/manager-api/videos/"):])
                self._send_json(*api_delete_video(folder_id))
            elif path.startswith("/manager-api/playlists/"):
                folder_id = unquote(path[len("/manager-api/playlists/"):])
                self._send_json(*api_delete_playlist(folder_id))
            else:
                self.send_error(404)
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress per-request noise


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), ManagerHandler)
    print(f"  BounceX Manager  →  {MANAGER_URL}")
    print(f"  Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
