# sync. extension for Adobe Premiere Pro & After Effects

Beautiful, minimal Premiere Pro and After Effects panel for lipsyncing using the sync. API, with a local helper server. Open‑source and easy to install for developers and editors.

## Features

- **One-click lipsync**: Instantly generate and insert lipsynced audio/video into your Premiere Pro or After Effects project using the sync. API.
- **Drag-and-drop UI**: Effortlessly add video and audio sources via a modern, minimal panel interface.
- **In/Out point selection**: Choose specific segments of your video for lipsyncing, with support for custom in/out points.
- **Automatic output management**: Output files are saved directly to your project folder or Documents, with host-aware directory detection.
- **After Effects & Premiere Pro support**: Works natively in both AE and PPro, with host-specific import and bin management.
- **Batch job history**: Save and insert previous jobs from the built-in history tab directly into your project.
- **Automatic backend management**: Local Node.js server auto-starts and handles all file operations, transcoding, and API communication.
- **ffmpeg integration**: Handles all necessary transcoding for After Effects workflows, including audio extraction and format conversion.

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
- **ffmpeg**: Required for After Effects transcoding (auto-installed via Homebrew on macOS)
- **CEP Runtime**: 11.0+ (automatically enabled by install script)

### Network
- Local server runs on port 3000 (auto-starts with extension)
- Internet connection required for sync API and updates

### Repository layout
- `CSXS/manifest.xml` — CEP manifest (ExtensionBundleId, hosts, icons)
- `index.html` — panel UI and logic
- `host/ppro.jsx` — ExtendScript bridge to Premiere (exports, import/insert, dialogs)
- `lib/CSInterface.js` — CEP host bridge
- `epr/` — Adobe Media Encoder export presets used for In/Out renders
- `server/` — local Node helper (jobs, costs, file operations)
- `icons/` — panel icons
- `scripts/` — helper scripts (dev install, package ZXP)

## Quick Start

### macOS Installation
```bash
git clone https://github.com/mhadifilms/sync-premiere.git
cd sync-premiere
chmod +x scripts/dev-install.sh
./scripts/dev-install.sh
```

### Windows Installation
```cmd
git clone https://github.com/mhadifilms/sync-premiere.git
cd sync-premiere
# Copy extension files to: %APPDATA%\Adobe\CEP\extensions\
# Enable PlayerDebugMode via registry or CEP utility
```

Then launch **Premiere Pro** or **After Effects** → Window → Extensions → "sync. for Premiere" or "sync. for After Effects".

**Note**: The install script automatically enables PlayerDebugMode for unsigned extensions (CSXS 10-14).

## Local Server
The panel communicates with a local Node.js server on port 3000. The server is bundled in `server/` and starts automatically when the extension loads.

**Auto-start**: Server launches automatically via `PPRO_startBackend` or `AEFT_startBackend` functions  
**Manual start** (optional):
```bash
cd server
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
- **Export preset missing** → Check files in `epr/` match names in the UI.
- **ffmpeg not found** → Install via Homebrew (macOS) or download from ffmpeg.org

### System Issues
- **Node.js not found** → Install Node.js 16+ from nodejs.org
- **Permission errors** → Run install script with appropriate permissions
- **Windows compatibility** → Ensure Windows 10 1903+ and Adobe 2024+

## Updates
The extension includes an automatic update system:
- Click "check updates" in the extension settings
- Updates are downloaded from GitHub releases
- Restart Adobe app after update installation