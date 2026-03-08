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

This starts both the main site AND the manager.

   **Linux & Mac:**

   ```bash
   chmod +x StartWebsite.sh
   ./StartWebsite.sh
   ```

   **Windows:**

   This is UNTESTED because I don't use Windows :]

   ```bash
   run-server.bat
   ```

This script automatically activates the virtual environment and starts the website.

#### Manual Start

If you prefer to start the server manually:

**Linux/Mac:**

```bash
source ./venv/bin/activate
python bump-sw.py
python manager.py & # This is optional! If you don't need to manage videos, you can omit this.
python -m RangeHTTPServer 8000 --bind 0.0.0.0
```

and after running, kill the manager PID then deactivate venv.

```bash
kill [Insert PID here] # Unnecessary if you skipped manager.py
deactivate
```

**Windows:**

To be honest, I don't really know what you do on Windows.
This is my best guess. Just use the .bat file honestly it makes this so much easier.

On Command Prompt:
```bash
venv\Scripts\activate.bat
python bump-sw.py
python -m RangeHTTPServer 8000 --bind 0.0.0.0
```
if you need to use the video manager, open in a second tab:
```bash
python manager.py
```
There's probably a better way to do this, but this is the simplest. Let me know if there's a better way!

**Important Security Note:** By default, the server binds to all network interfaces (`0.0.0.0`), making it accessible on your local network. If you only want local access (just this device), omit the `--bind` flag and everything after it:

```bash
python -m RangeHTTPServer 8000
```

### Accessing the Website

Once the server is running, open your browser and navigate to:

```
http://localhost:8000
```
If you want to access it from another device on your local network:
```
http://[YOURLOCALIPHERE]:8000
```

## Adding Videos (Automatic) (Recommended)

### 1. Download a valid package for this website. 

The source could really be anyone, but the [DH Discord Server](https://discord.gg/Y8YdgmH8Ka) is likely a good place to start.
You will know it's valid where the root of the .zip (when you double click it) just contains a video and or playlist folder.

### 2. Visit the manager and drag the .zip in

In the navigation bar of the website, open "Manager" and drag the .zip into the window, or click the import .zip button.

### 3. Verify that your new videos are at the top of the list!

You can drag the videos/playlists up and down to change the order they appear.

## Adding Videos (Manual)

To manually add custom video content or create new packages, follow these steps:

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

### 3.5. Some Notes:

- You can add multiple .bx files to one video under the bxFiles section if you add additional entries.
- For highlighted tags, I like to do 3: Difficulty, Type of video, and then video creator. Do what you like, but that's how I prefer it.
- Duration is calculated in FRAMES, not seconds.

### 3.6. Special Tags & Naming Conventions:

The following are SUGGESTIONS and NOT NECESSARY, but a recommendation for keeping things organized.

The original inspiration for this project was so I could split BounceX compilations into their individual parts/songs, so if a video only has 1 song, then use that as the title. If there are multiple songs, just name it whatever (when I convert regular PMV/HMVs, I just use the video title).

There are a handful of "special" tags which make it easy to filter. You can see all of the "special" tags in the videos tab. The categories are:

#### Video Type
- BounceX
- Dildo Hero (You can use the funscript converter in the [DH Discord Server](https://discord.gg/u6CZ3Zm4PC) to convert some of these to be compatible!) 
- Other

#### Difficulty
- Easy
- Medium
- Hard
- Extreme
- Multi-Difficulty (Use this when you use more than 1 path, otherwise indicate how hard on average the path is.)

#### Song Quantity
- Single Song
- Compilation (If there are multiple MAIN songs in the video, use this)
- No Song

### 4. Playback Behavior

- The path plays immediately in perfect sync with the video
- No offset function is currently available, so make sure the path is synced to the video. There is a tool in the Tools folder to add some offset, but it requires some extra setup.

### 5. Packaging for sharing
When creating a package to share, ONLY include a videos and/or playlists folder in the root directory of the .zip.
Omit any files other than the 4 needed, so do NOT include manifest.json.

### 6. Development Tips

If you run into any issues, try a hard refresh:

**Windows/Linux:** `Ctrl + Shift + R`  
**Mac:** `Cmd + Shift + R`

This resolves most caching issues that may occur. This also may erase some settings.

---

**Need help?** Check the existing examples in the `/videos/` directory for reference implementations or ask me directly on Discord!

## Credits:

Thank you to [Optiacku](https://github.com/clbhundley/BounceX) in the [DH Discord Server](https://discord.gg/u6CZ3Zm4PC) for creating the original concept for BounceX! (This project was not endorsed or encouraged by Optiacku, I merely made a more convenient way to view the .bx files)
