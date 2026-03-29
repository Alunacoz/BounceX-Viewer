#!/usr/bin/env python3
"""
BounceX Manager Server
Run with:  python manager.py
Opens the manager page automatically.
"""

import io
import json
import re
import shutil
import sys
import tempfile
import zipfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).parent.parent.resolve()   # scripts/ → project root
APP_DIR = ROOT / "app"
VIDEO_BASE = ROOT / "videos"
PLAYLIST_BASE = ROOT / "playlists"

# Read ports from the shared config file
_config_path = ROOT / "config.json"
with open(_config_path, "r", encoding="utf-8") as _f:
    _config = json.load(_f)
PORT = _config["managerPort"]
HTTP_PORT = _config["httpPort"]
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


# ── API: update video package ──────────────────────────────────────────────────

def api_update_video(handler, folder_id: str):
    if not folder_id or '/' in folder_id or '\\' in folder_id or folder_id in ('.', '..'):
        return {"error": "Invalid folder id"}, 400

    ct = handler.headers.get('Content-Type', '')
    if 'multipart/form-data' not in ct:
        return {"error": "Expected multipart/form-data"}, 400

    folder_path = VIDEO_BASE / folder_id
    if not folder_path.exists():
        return {"error": f'Folder not found: {folder_id}'}, 404

    try:
        fields, files = parse_multipart_form(handler)
    except Exception as e:
        return {"error": f"Failed to parse form data: {e}"}, 400

    # ── Parse meta ──────────────────────────────────────────────────────────
    try:
        meta = json.loads(fields.get('meta', '{}'))
    except json.JSONDecodeError as e:
        return {"error": f"Invalid meta JSON: {e}"}, 400

    # ── Handle folder rename ────────────────────────────────────────────────
    new_folder_id = fields.get('newFolderId', folder_id).strip()
    if not new_folder_id:
        new_folder_id = folder_id
    if '/' in new_folder_id or '\\' in new_folder_id or new_folder_id in ('.', '..'):
        return {"error": "Invalid new folder ID"}, 400

    if new_folder_id != folder_id:
        new_folder_path = VIDEO_BASE / new_folder_id
        if new_folder_path.exists():
            return {"error": f'Folder "{new_folder_id}" already exists'}, 409
        # Rename the folder on disk
        folder_path.rename(new_folder_path)
        folder_path = new_folder_path
        # Update manifest
        manifest_path = VIDEO_BASE / 'manifest.json'
        if manifest_path.exists():
            manifest = read_json(manifest_path)
            if folder_id in manifest:
                idx = manifest.index(folder_id)
                manifest[idx] = new_folder_id
                write_json(manifest_path, manifest)

    try:
        # ── Video file (optional replacement) ──────────────────────────────
        if 'video' in files:
            video_filename, video_bytes = files['video']
            if video_filename and video_bytes:
                # Remove old video file if different name
                old_video = meta.get('videoFile')
                if old_video and old_video != video_filename:
                    old_path = folder_path / old_video
                    if old_path.exists():
                        old_path.unlink()
                with open(folder_path / video_filename, 'wb') as f:
                    f.write(video_bytes)
                meta['videoFile'] = video_filename

        # ── Thumbnail (optional replacement) ───────────────────────────────
        if 'thumbnail' in files:
            thumb_filename, thumb_bytes = files['thumbnail']
            if thumb_filename and thumb_bytes:
                old_thumb = meta.get('thumbnail')
                if old_thumb and old_thumb != thumb_filename:
                    old_path = folder_path / old_thumb
                    if old_path.exists():
                        old_path.unlink()
                with open(folder_path / thumb_filename, 'wb') as f:
                    f.write(thumb_bytes)
                meta['thumbnail'] = thumb_filename

        # ── BX files ────────────────────────────────────────────────────────
        # Each slot is either a new upload (bxFile_N) or a keep-existing ref (bxExistingFile_N)
        bx_count_str = fields.get('bxCount', '')
        if bx_count_str.isdigit():
            bx_count = int(bx_count_str)
            bx_files_meta = []
            for i in range(bx_count):
                label = fields.get(f'bxLabel_{i}', 'Default')
                if f'bxFile_{i}' in files:
                    bx_filename, bx_bytes = files[f'bxFile_{i}']
                    if bx_filename and bx_bytes:
                        with open(folder_path / bx_filename, 'wb') as f:
                            f.write(bx_bytes)
                        bx_files_meta.append({"label": label, "file": bx_filename})
                elif f'bxExistingFile_{i}' in fields:
                    existing_name = fields[f'bxExistingFile_{i}']
                    if existing_name:
                        bx_files_meta.append({"label": label, "file": existing_name})
            if bx_files_meta:
                meta['bxFiles'] = bx_files_meta

        # Write meta.json
        write_json(folder_path / 'meta.json', meta)
        bump_version()
        return {"updated": new_folder_id, "renamed": new_folder_id != folder_id}, 200

    except Exception as e:
        return {"error": f"Failed to update package: {e}"}, 500


# ── Playlist duration tally ────────────────────────────────────────────────────

def _tally_playlist_duration(videos: list):
    """
    Sum duration across all video entries in a playlist.
    Priority per video:
      1. durationSecs  (float, seconds)
      2. duration      (int, frames @ 60 fps)
      3. probe the actual video file via a subprocess ffprobe if available
    Always returns a float (0.0 if truly nothing can be determined).
    """
    import subprocess
    import shutil

    total = 0.0
    has_ffprobe = shutil.which('ffprobe') is not None

    for entry in videos:
        folder_id = entry if isinstance(entry, str) else (entry.get('id') or entry.get('videoId') or '')
        if not folder_id:
            continue

        folder = VIDEO_BASE / folder_id
        meta_path = folder / 'meta.json'

        video_dur = None

        # ── 1. Read from meta.json ──────────────────────────────────────────
        try:
            vmeta = read_json(meta_path)
            if vmeta.get('durationSecs') is not None:
                video_dur = float(vmeta['durationSecs'])
            elif vmeta.get('duration') is not None:
                video_dur = float(vmeta['duration']) / 60.0  # frames → secs @ 60fps
        except Exception:
            vmeta = {}

        # ── 2. Probe the video file if still unknown ────────────────────────
        if video_dur is None and has_ffprobe:
            video_file = vmeta.get('videoFile') if vmeta else None
            if not video_file:
                # Guess: look for any video file in the folder
                for ext in ('.mp4', '.webm', '.mkv', '.mov'):
                    candidate = folder / (folder_id + ext)
                    if candidate.exists():
                        video_file = candidate.name
                        break
                if not video_file and folder.is_dir():
                    for f in sorted(folder.iterdir()):
                        if f.suffix.lower() in ('.mp4', '.webm', '.mkv', '.mov'):
                            video_file = f.name
                            break
            if video_file:
                video_path = folder / video_file
                if video_path.exists():
                    try:
                        result = subprocess.run(
                            ['ffprobe', '-v', 'quiet', '-print_format', 'json',
                             '-show_format', str(video_path)],
                            capture_output=True, text=True, timeout=10
                        )
                        import json as _json
                        probe = _json.loads(result.stdout)
                        dur = float(probe.get('format', {}).get('duration', 0))
                        if dur > 0:
                            video_dur = dur
                            # Persist so future saves don't need to probe again
                            try:
                                vmeta['durationSecs'] = round(dur, 3)
                                write_json(meta_path, vmeta)
                            except Exception:
                                pass
                    except Exception:
                        pass

        if video_dur is not None:
            total += video_dur
        else:
            print(f'[tally] Warning: no duration found for video "{folder_id}"', flush=True)

    return total


# ── API: create playlist ───────────────────────────────────────────────────────

def api_create_playlist(handler):
    ct = handler.headers.get('Content-Type', '')
    if 'multipart/form-data' not in ct:
        return {"error": "Expected multipart/form-data"}, 400

    try:
        fields, files = parse_multipart_form(handler)
    except Exception as e:
        return {"error": f"Failed to parse form data: {e}"}, 400

    folder_id = fields.get('folderId', '').strip()
    if not folder_id:
        return {"error": "folderId is required"}, 400
    if '/' in folder_id or '\\' in folder_id or folder_id in ('.', '..'):
        return {"error": "Invalid folder ID"}, 400

    folder_path = PLAYLIST_BASE / folder_id
    if folder_path.exists():
        return {"error": f'Folder "{folder_id}" already exists'}, 409

    try:
        meta = json.loads(fields.get('meta', '{}'))
    except json.JSONDecodeError as e:
        return {"error": f"Invalid meta JSON: {e}"}, 400

    folder_path.mkdir(parents=True, exist_ok=False)
    try:
        if 'thumbnail' in files:
            thumb_filename, thumb_bytes = files['thumbnail']
            if thumb_filename and thumb_bytes:
                with open(folder_path / thumb_filename, 'wb') as f:
                    f.write(thumb_bytes)
                meta['thumbnail'] = thumb_filename

        # Tally total runtime from video metas
        total_dur = _tally_playlist_duration(meta.get('videos', []))
        meta['totalDurationSecs'] = round(total_dur, 3)

        write_json(folder_path / 'meta.json', meta)

        manifest_path = PLAYLIST_BASE / 'manifest.json'
        if manifest_path.exists():
            manifest = read_json(manifest_path)
        else:
            PLAYLIST_BASE.mkdir(parents=True, exist_ok=True)
            manifest = []
        manifest.insert(0, folder_id)
        write_json(manifest_path, manifest)
        bump_version()
        return {"created": folder_id}, 200

    except Exception as e:
        if folder_path.exists():
            shutil.rmtree(folder_path)
        return {"error": f"Failed to create playlist: {e}"}, 500


# ── API: update playlist ───────────────────────────────────────────────────────

def api_update_playlist(handler, folder_id: str):
    if not folder_id or '/' in folder_id or '\\' in folder_id or folder_id in ('.', '..'):
        return {"error": "Invalid folder id"}, 400

    ct = handler.headers.get('Content-Type', '')
    if 'multipart/form-data' not in ct:
        return {"error": "Expected multipart/form-data"}, 400

    folder_path = PLAYLIST_BASE / folder_id
    if not folder_path.exists():
        return {"error": f'Folder not found: {folder_id}'}, 404

    try:
        fields, files = parse_multipart_form(handler)
    except Exception as e:
        return {"error": f"Failed to parse form data: {e}"}, 400

    try:
        meta = json.loads(fields.get('meta', '{}'))
    except json.JSONDecodeError as e:
        return {"error": f"Invalid meta JSON: {e}"}, 400

    new_folder_id = fields.get('newFolderId', folder_id).strip() or folder_id
    if '/' in new_folder_id or '\\' in new_folder_id or new_folder_id in ('.', '..'):
        return {"error": "Invalid new folder ID"}, 400

    if new_folder_id != folder_id:
        new_folder_path = PLAYLIST_BASE / new_folder_id
        if new_folder_path.exists():
            return {"error": f'Folder "{new_folder_id}" already exists'}, 409
        folder_path.rename(new_folder_path)
        folder_path = new_folder_path
        manifest_path = PLAYLIST_BASE / 'manifest.json'
        if manifest_path.exists():
            manifest = read_json(manifest_path)
            if folder_id in manifest:
                manifest[manifest.index(folder_id)] = new_folder_id
                write_json(manifest_path, manifest)

    try:
        if 'thumbnail' in files:
            thumb_filename, thumb_bytes = files['thumbnail']
            if thumb_filename and thumb_bytes:
                old_thumb = meta.get('thumbnail')
                if old_thumb and old_thumb != thumb_filename:
                    old_path = folder_path / old_thumb
                    if old_path.exists():
                        old_path.unlink()
                with open(folder_path / thumb_filename, 'wb') as f:
                    f.write(thumb_bytes)
                meta['thumbnail'] = thumb_filename

        # Tally total runtime from video metas
        total_dur = _tally_playlist_duration(meta.get('videos', []))
        meta['totalDurationSecs'] = round(total_dur, 3)

        write_json(folder_path / 'meta.json', meta)
        bump_version()
        return {"updated": new_folder_id, "renamed": new_folder_id != folder_id}, 200

    except Exception as e:
        return {"error": f"Failed to update playlist: {e}"}, 500


# ── API: export package (zip) ──────────────────────────────────────────────────

def api_export_package(handler):
    content_length = int(handler.headers.get('Content-Length', 0))
    if content_length == 0:
        return {"error": "Empty request body"}, 400

    raw = handler.rfile.read(content_length)
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}, 400

    video_ids = [v for v in body.get('videos', []) if isinstance(v, str)]
    playlist_ids = [p for p in body.get('playlists', []) if isinstance(p, str)]

    if not video_ids and not playlist_ids:
        return {"error": "No videos or playlists selected"}, 400

    for vid in video_ids:
        if '/' in vid or '\\' in vid or vid in ('.', '..'):
            return {"error": f"Invalid video id: {vid}"}, 400
    for pid in playlist_ids:
        if '/' in pid or '\\' in pid or pid in ('.', '..'):
            return {"error": f"Invalid playlist id: {pid}"}, 400

    filename = body.get('filename', 'package').strip() or 'package'
    filename = re.sub(r'[^\w\-. ]', '_', filename).strip()
    if not filename.endswith('.zip'):
        filename += '.zip'

    # Write to a temp file instead of an in-memory BytesIO so we never hold
    # the entire (potentially multi-GB) zip in RAM at once.
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp.name
    try:
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for vid in video_ids:
                folder = VIDEO_BASE / vid
                if not folder.is_dir():
                    continue
                for file_path in sorted(folder.rglob('*')):
                    if file_path.is_file():
                        arc_name = f"videos/{vid}/{file_path.relative_to(folder)}"
                        zf.write(file_path, arc_name)

            for pid in playlist_ids:
                folder = PLAYLIST_BASE / pid
                if not folder.is_dir():
                    continue
                for file_path in sorted(folder.rglob('*')):
                    if file_path.is_file():
                        arc_name = f"playlists/{pid}/{file_path.relative_to(folder)}"
                        zf.write(file_path, arc_name)

        zip_size = Path(tmp_path).stat().st_size

        handler.send_response(200)
        handler.send_header('Content-Type', 'application/zip')
        handler.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        handler.send_header('Content-Length', str(zip_size))
        handler.send_header('Access-Control-Allow-Origin', '*')
        handler.send_header('Cache-Control', 'no-store')
        handler.end_headers()

        # Stream the zip to the client in 4 MB chunks — never holds full zip in RAM
        CHUNK = 4 * 1024 * 1024
        with open(tmp_path, 'rb') as f:
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                try:
                    handler.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break  # client disconnected mid-download

    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass

    return None, None   # already sent



# ── Export token store (in-memory, one-use) ────────────────────────────────────
import secrets
_export_tokens = {}   # token -> {videos, playlists, filename}

def api_export_token(handler):
    """POST: store export job, return a one-use token."""
    content_length = int(handler.headers.get('Content-Length', 0))
    if content_length == 0:
        return {"error": "Empty request body"}, 400
    try:
        body = json.loads(handler.rfile.read(content_length))
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}, 400

    video_ids    = [v for v in body.get('videos', [])    if isinstance(v, str)]
    playlist_ids = [p for p in body.get('playlists', []) if isinstance(p, str)]
    if not video_ids and not playlist_ids:
        return {"error": "No videos or playlists selected"}, 400

    for vid in video_ids:
        if '/' in vid or '\\' in vid or vid in ('.', '..'):
            return {"error": f"Invalid video id: {vid}"}, 400
    for pid in playlist_ids:
        if '/' in pid or '\\' in pid or pid in ('.', '..'):
            return {"error": f"Invalid playlist id: {pid}"}, 400

    token = secrets.token_urlsafe(32)
    _export_tokens[token] = {
        "videos":    video_ids,
        "playlists": playlist_ids,
        "filename":  body.get("filename", "package"),
    }
    return {"token": token}, 200


# ── Chunked transfer writer ────────────────────────────────────────────────────
# Wraps handler.wfile so zipfile can write directly to the HTTP response
# without buffering the entire archive in RAM or on disk first.
# Uses HTTP/1.1 chunked transfer encoding: each write is framed as
#   <hex-length>\r\n<data>\r\n
# terminated by a zero-length chunk.

class _ChunkedWriter:
    FLUSH_SIZE = 2 * 1024 * 1024  # flush to client every 2 MB

    def __init__(self, wfile):
        self._wfile = wfile
        self._buf   = bytearray()
        self._pos   = 0   # logical bytes written — zipfile uses this for offsets

    def write(self, data):
        self._buf.extend(data)
        self._pos += len(data)
        if len(self._buf) >= self.FLUSH_SIZE:
            self._flush()
        return len(data)

    def flush(self):
        self._flush()

    def _flush(self):
        if not self._buf:
            return
        chunk = bytes(self._buf)
        self._buf = bytearray()
        try:
            self._wfile.write(f"{len(chunk):x}\r\n".encode())
            self._wfile.write(chunk)
            self._wfile.write(b"\r\n")
            self._wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def close(self):
        self._flush()
        try:
            self._wfile.write(b"0\r\n\r\n")
            self._wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    # Returning False makes zipfile use streaming data descriptors per entry,
    # but tell() must still return accurate offsets so the central directory is valid.
    def seekable(self): return False
    def tell(self):     return self._pos


# Already-compressed extensions — store them as-is, don't waste CPU deflating
_STORED_EXTS = {
    ".mp4", ".webm", ".mkv", ".mov", ".avi",
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".zip", ".gz", ".bz2", ".xz", ".zst",
}


def api_export_download(handler, token):
    """GET: consume token, stream zip directly to browser via chunked encoding."""
    job = _export_tokens.pop(token, None)
    if job is None:
        return {"error": "Invalid or expired token"}, 404

    video_ids    = job["videos"]
    playlist_ids = job["playlists"]
    filename     = re.sub(r'[^\w\-. ]', '_', job["filename"].strip()) or "package"
    if not filename.endswith(".zip"):
        filename += ".zip"

    # Send headers immediately — browser sees the download start right away
    handler.protocol_version = "HTTP/1.1"
    handler.send_response(200)
    handler.send_header("Content-Type", "application/zip")
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Transfer-Encoding", "chunked")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()

    writer = _ChunkedWriter(handler.wfile)
    try:
        with zipfile.ZipFile(writer, "w", allowZip64=True) as zf:
            def add_folder(base_path, arc_prefix):
                for file_path in sorted(base_path.rglob("*")):
                    if not file_path.is_file():
                        continue
                    compress = (
                        zipfile.ZIP_STORED
                        if file_path.suffix.lower() in _STORED_EXTS
                        else zipfile.ZIP_DEFLATED
                    )
                    arc_name = f"{arc_prefix}/{file_path.relative_to(base_path)}"
                    zf.write(file_path, arc_name, compress_type=compress)

            for vid in video_ids:
                folder = VIDEO_BASE / vid
                if folder.is_dir():
                    add_folder(folder, f"videos/{vid}")

            for pid in playlist_ids:
                folder = PLAYLIST_BASE / pid
                if folder.is_dir():
                    add_folder(folder, f"playlists/{pid}")
    except (BrokenPipeError, ConnectionResetError):
        pass   # client disconnected mid-download — not an error
    finally:
        writer.close()

    return None, None

# ── HTTP handler ───────────────────────────────────────────────────────────────

class ManagerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path == "/manager-api/config":
            self._send_json({"httpPort": HTTP_PORT, "managerPort": PORT})
        elif path == "/config.json":
            # nav-config.js fetches /config.json from whatever port it's on
            try:
                with open(ROOT / "config.json", "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except OSError:
                self.send_error(404)
        elif path == "/manager-api/version":
            self._send_json({"version": _version})
        elif path == "/manager-api/export-download":
            from urllib.parse import parse_qs
            qs = parse_qs(urlparse(self.path).query)
            token = qs.get("token", [None])[0]
            if not token:
                self._send_json({"error": "Missing token"}, 400)
            else:
                try:
                    result, status = api_export_download(self, token)
                    if result is not None:
                        self._send_json(result, status)
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)
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
        elif re.match(r'^/manager-api/videos/[^/]+/update$', path):
            folder_id = unquote(path[len("/manager-api/videos/"):-len("/update")])
            try:
                self._send_json(*api_update_video(self, folder_id))
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
        elif path == "/manager-api/playlists/create":
            try:
                self._send_json(*api_create_playlist(self))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif re.match(r'^/manager-api/playlists/[^/]+/update$', path):
            pl_id = unquote(path[len("/manager-api/playlists/"):-len("/update")])
            try:
                self._send_json(*api_update_playlist(self, pl_id))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif path == "/manager-api/export-token":
            try:
                result, status = api_export_token(self)
                self._send_json(result, status)
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

class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in its own thread so large downloads don't block the manager."""
    daemon_threads = True

if __name__ == "__main__":
    server = _ThreadingHTTPServer(("0.0.0.0", PORT), ManagerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
