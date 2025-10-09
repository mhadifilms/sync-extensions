# sync. extension for Adobe Premiere Pro & After Effects

A Premiere Pro and After Effects panel for lipsyncing using the sync. API, with a local helper server.

## Features

- **One-click lipsync**: Instantly generate and insert lipsynced audio/video into your Premiere Pro or After Effects project using the sync. API.
- **Drag-and-drop UI**: Effortlessly add video and audio sources via a modern, minimal panel interface.
- **In/Out point selection**: Choose specific segments of your video for lipsyncing, with support for custom in/out points.
- **Automatic output management**: Output files are saved directly to your project folder or Documents, with host-aware directory detection.
- **After Effects & Premiere Pro support**: Works natively in both AE and PPro, with host-specific import and bin management.
- **Batch job history**: Save and insert previous jobs from the built-in history tab directly into your project.
- **Automatic backend management**: Local Node.js server auto-starts and handles all file operations, transcoding, and API communication.
- **Pure Node.js audio conversion**: Handles AIFF to WAV/MP3 conversion without external dependencies.

## Limitations
- Uses Supabase for file storage on files above 20MB, and for files up to 1GB. Files above 1GB are automatically rejected.
- Uses port 300 for local server communication, but currently kills any existing server processes when starting a new one.
- ProRes videos show up as black in the preview, but work fine due to a Chromium limitation.
- Currently no support for in-app audio generation.

## System Requirements

### Operating Systems
- **macOS**: 10.15 (Catalina) or later
- **Windows**: Windows 10 version 1903 or later

### Adobe Applications
- **Premiere Pro**: 2024 (24.0) or later
- **After Effects**: 2024 (24.0) or later

### Dependencies
- **Node.js**: 16.0 or later (auto-detected from common install locations)
- **Node.js**: Required for audio conversion and server functionality (auto-installed via Homebrew on macOS)
- **CEP Runtime**: 11.0+ (automatically enabled by install script)

### Package Managers (for automated installation)
- **macOS**: Homebrew (https://brew.sh/) - Required for automatic Node.js installation
- **Windows**: No additional package manager required (uses built-in PowerShell)

### Network
- Local server runs on port 3000 (auto-starts with extension)
- Internet connection required for sync API and updates

### Repository layout
- `CSXS/manifest.xml` — CEP manifest (ExtensionBundleId, hosts, icons)
- `index.html` — panel UI and logic
- `host/ppro.jsx` — ExtendScript bridge to Premiere (exports, import/insert, dialogs)
- `lib/CSInterface.js` — CEP host bridge
- `extensions/premiere-extension/epr/` — Adobe Media Encoder export presets used for In/Out renders (Premiere only)
- `server/` — local Node helper (jobs, costs, file operations)
- `icons/` — panel icons
- `scripts/` — helper scripts (dev install, package ZXP)

## Installation

### Quick Install (Recommended)

**macOS:**
```bash
# Download and extract the ZIP, then run:
cd com.sync.extension.premiere.panel  # or .ae.panel for After Effects
./scripts/install.sh --premiere
```

**Windows:**
```powershell
# Download and extract the ZIP, then run:
cd com.sync.extension.premiere.panel  # or .ae.panel for After Effects
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -App premiere
```

**Manual Install (if scripts fail):**
1. Download ZIP from [releases](https://github.com/mhadifilms/sync-extensions/releases)
2. Extract and move `com.sync.extension.premiere.panel` to:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
3. Enable debug mode:
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
   - Windows: Set registry `HKEY_CURRENT_USER\Software\Adobe\CSXS.11\PlayerDebugMode = 1`
4. Restart Premiere Pro → Window → Extensions → "sync. for Premiere"

## Local Server
The panel communicates with a local Node.js server on port 3000. The server is bundled in `server/` and starts automatically when the extension loads.

**Auto-start**: Server launches automatically via `PPRO_startBackend` or `AEFT_startBackend` functions  
**Manual start** (if auto-start fails):
```bash
# Navigate to extension folder
cd ~/Library/Application\ Support/Adobe/CEP/extensions/com.sync.extension.ppro.panel/server

# Install dependencies (if needed)
npm install --omit=dev

# Start server manually
npm start
```

**For After Effects:**
```bash
cd ~/Library/Application\ Support/Adobe/CEP/extensions/com.sync.extension.ae.panel/server
npm install --omit=dev
npm start
```

**Node.js Detection**: The extension automatically finds Node.js in common locations:
- macOS: `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/usr/bin/node`
- Windows: PATH environment variable

## Settings supported
- Model selection
- Sync mode: loop, bounce, cut_off, remap, silence
- Temperature
- Active speaker detection
- Occlusion detection
- Supabase URL / Key / Bucket, Save location

## Features
- **Model Selection**: Choose from available sync models
- **Sync Modes**: loop, bounce, cut_off, remap, silence
- **Temperature Control**: Adjust sync sensitivity
- **Active Speaker Detection**: Automatic speaker identification
- **Occlusion Detection**: Handle visual obstructions
- **Supabase Integration**: Cloud storage for large files
- **Auto Updates**: Built-in update system via GitHub releases

## Troubleshooting

### Extension Issues
- **Extension not visible** → Ensure PlayerDebugMode is enabled (install script sets this). Restart Adobe app.
- **Backend not responding** → Port 3000 might be blocked. Quit conflicting apps or restart Adobe app.
- **Version shows "unknown"** → Server may not be running. Check extension logs.

### Media Issues
- **ProRes preview shows black** → Chromium won't decode ProRes; preview uses H.264.
- **Export preset missing** → Check files in `extensions/premiere-extension/epr/` match names in the UI.
- **Audio conversion failed** → Check Node.js installation and server status

### System Issues
- **Node.js not found** → Install Node.js 16+ from nodejs.org or via Homebrew (`brew install node`)
- **Homebrew not found (macOS)** → Install Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- **Permission errors** → Run install script with appropriate permissions
- **Windows compatibility** → Ensure Windows 10 1903+ and Adobe 2024+

## Updates
The extension includes an automatic update system:
- Click "check updates" in the extension settings
- Updates are downloaded from GitHub releases
- Restart Adobe app after update installation