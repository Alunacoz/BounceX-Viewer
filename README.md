# BounceX-Viewer

> **License:** MIT License + Commons Clause  
> ⚠️ **Note:** Don't steal features to commercialize it!

An admittedly vibe-coded, self-hosted, private video viewer that syncs BounceX paths to corresponding videos with full customization options.

## AI Disclosure

This program was written with generative AI, with human intervention as well. I felt like it was important to be upfront with this information because I understand that it is not everyone's cup of tea.

## Features

- 🎯 **Path Synchronization**: Automatically syncs BounceX paths to their corresponding videos! Works when scrubbing as well!
- 🎨 **Customization**: Full path customization including colors, size, and more!
- 🔒 **Private & Self-Hosted**: Completely private! Host any video you like on your own personal network!

## Getting Started

### Prerequisites

- Python 3.x
- pip

### Installation

1. **Create a Python virtual environment:**

   ```bash
   python -m venv venv
   ```

2. **Activate the virtual environment:**

   **Linux & Mac:**

   ```bash
   source ./venv/bin/activate
   ```

   **Windows:**

   ```bash
   venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

### Running the Server

#### Using the Start Script (Recommended)

A convenience script `StartWebsite.sh` is provided for Linux and Mac users:

```bash
chmod +x ./StartWebsite.sh
./StartWebsite.sh
```

This script automatically activates the virtual environment and starts the website.

#### Manual Start

If you prefer to start the server manually or are on Windows, after activating the venv run:

```bash
python -m RangeHTTPServer 8000 --bind 0.0.0.0
```

**Important Security Note:** By default, the server binds to all network interfaces (`0.0.0.0`), making it accessible on your local network. If you only want local access (just this device), omit the `--bind` flag and everything after it:

```bash
python -m RangeHTTPServer 8000
```

### Accessing the Website

Once the server is running, open your browser and navigate to:

```
http://localhost:8000
```

## Adding Videos

To add custom video content, follow these steps:

### 1. Create Video Folder

Create a new folder in `/videos/`.

### 2. Update Manifest

Add a new entry in `manifest.json` with the **exact** name of your folder, following the existing pattern format.

### 3. Add Required Files

Inside your video folder, include the following files:

| File        | Description     | Notes                                                   |
| ----------- | --------------- | ------------------------------------------------------- |
| `meta.json` | Metadata file   | Fill in according to the provided examples              |
| `video.mp4` | Video file      | Can use any filename, but must be `.mp4` format         |
| `path.bx`   | Path data file  | Can use any filename, must be `.bx` format              |
| `thumb.jpg` | Thumbnail image | `.jpg` or `.png` accepted; placeholder shown if missing |

**⚠️ Important:** Create and configure `meta.json` first before adding other files.

### 4. Playback Behavior

- The path plays immediately in perfect sync with the video
- No offset function is currently available, so make sure the path is synced to the video.

### 5. Development Tips

If you're working locally and experience issues, try a hard refresh:

**Windows/Linux:** `Ctrl + Shift + R`  
**Mac:** `Cmd + Shift + R`

This resolves most caching issues that may occur during development.

---

**Need help?** Check the existing examples in the `/videos/` directory for reference implementations.

## Credits:

Thank you to [Optiacku](https://github.com/clbhundley/BounceX) in the [DH Discord Server](https://discord.gg/u6CZ3Zm4PC) for creating the original concept for BounceX! (This project was not endorsed or encouraged by Optiacku, I merely made a more convenient way to view the .bx files)
