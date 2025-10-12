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
 - **Automatic backend management (bundled Node)**: A private Node.js runtime is bundled per-OS and started by the panel. No system Node or npm install required.

## System Requirements

### Operating Systems
- **macOS**: 10.15 (Catalina) or later
- **Windows**: Windows 10 or later

### Adobe Applications
- **Premiere Pro**: 2024 (24.0) or later
- **After Effects**: 2024 (24.0) or later

### Dependencies
- **Bundled Node runtime**: Included in the extension (`bin/`) for macOS (arm64, x64) and Windows (x64). The panel spawns this runtime; no system Node is required.
- **CEP Runtime**: 11.0+

### Network
- Local server runs on port 3000 (auto-starts with extension)
- Internet connection required for sync API and updates

## Installation

### Recommended (signed ZXP)
1. Download the platform/app ZXP from the latest [Release](https://github.com/mhadifilms/sync-extensions/releases):
   - `sync-extension-ae-windows-signed.zxp`
   - `sync-extension-premiere-windows-signed.zxp`
   - `sync-extension-ae-mac-signed.zxp`
   - `sync-extension-premiere-mac-signed.zxp`
2. Install with a ZXP installer (e.g., aescripts ZXP Installer or Anastasiy’s Extension Manager).
3. Restart Adobe app and open the panel from Window → Extensions.

### Developer install (unzipped folder)
1. Extract the ZXP (it's a ZIP) and copy `com.sync.extension.*` to CEP extensions:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
2. If needed for dev builds, enable PlayerDebugMode:
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
   - Windows: `HKEY_CURRENT_USER\Software\Adobe\CSXS.11\PlayerDebugMode = 1`
3. Restart the host app.

## Local Server
The panel communicates with a local Node.js server on port 3000. The server entry is `server/dist/server.js` (falls back to `server/src/server.js`) and is started by the bundled Node runtime under `bin/`.

**Auto-start**: The panel spawns the bundled Node per‑OS and starts the server automatically.  
**No npm install**: All runtime dependencies are shipped; users never run npm.

## Settings supported
- Model selection
- Sync mode: loop, bounce, cut_off, remap, silence
- Temperature
- Active speaker detection
- Occlusion detection

## Features
- **Model Selection**: Choose from available sync models
- **Sync Modes**: loop, bounce, cut_off, remap, silence
- **Temperature Control**: Adjust sync sensitivity
- **Active Speaker Detection**: Automatic speaker identification
- **Occlusion Detection**: Handle visual obstructions
- **Auto Updates**: Built-in update system via GitHub releases

## Troubleshooting

### Installation Issues
- **ZXP installer rejects extension** → Remove quarantine attributes: `xattr -d com.apple.provenance *.zxp`
- **macOS Gatekeeper blocks installation** → Remove quarantine attributes: `xattr -d com.apple.provenance *.zxp`

### Extension Issues
- **Extension not visible** → For dev builds, ensure PlayerDebugMode is enabled. Restart Adobe app.
- **Backend not responding** → Port 3000 may be blocked by another process. Restart the Adobe app.
- **Version shows "unknown"** → Server may not be running. Check extension logs (Help → Developer Tools).

### Media Issues
- **ProRes preview shows black** → Chromium won't decode ProRes; preview uses H.264.
- **Export preset missing** → Check files in `extensions/premiere-extension/epr/` match names in the UI.
- **Audio conversion failed** → Check Node.js installation and server status

### System Issues
- **ZXP installation failed** → Use a modern ZXP installer and ensure the ZXP is signed.
- **macOS Gatekeeper** → If blocked, allow the installer in System Settings → Privacy & Security.
- **Windows compatibility** → Windows 10 1903+ and Adobe 2024+ recommended.

## Updates
The extension includes an automatic update system:
- Click "Check updates" in the panel settings.
- The server downloads the appropriate ZXP asset based on OS (mac/windows) and app (AE/PPro).
- After the download, the panel installs the new version and prompts for restart.