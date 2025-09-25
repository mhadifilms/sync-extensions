# sync. extension for Adobe Premiere Pro (CEP)

Beautiful, minimal Premiere Pro panel for lipsyncing with a local helper server. Open‑source and easy to install for developers and editors.

### Repository layout
- `CSXS/manifest.xml` — CEP manifest (ExtensionBundleId, hosts, icons)
- `index.html` — panel UI and logic
- `host/ppro.jsx` — ExtendScript bridge to Premiere (exports, import/insert, dialogs)
- `lib/CSInterface.js` — CEP host bridge
- `epr/` — Adobe Media Encoder export presets used for In/Out renders
- `server/` — local Node helper (jobs, costs, file operations)
- `icons/` — panel icons
- `scripts/` — helper scripts (dev install, package ZXP)

## Quick start (unsigned dev install)

macOS:
```bash
git clone https://github.com/your-org/sync-premiere.git
cd sync-premiere
chmod +x scripts/dev-install.sh
./scripts/dev-install.sh
```
Then launch Premiere Pro → Window → Extensions → “sync. extension”.

Note: This enables PlayerDebugMode for CSXS 12/13 which allows unsigned extensions.

## Local server
The panel speaks to a small local server on port 3000. It is bundled in `server/` and is started automatically via `PPRO_startBackend` when needed. If the port is occupied, quit conflicting apps or restart Premiere.

Manual start (optional):
```bash
cd server
npm install
npm start
```

## Settings supported
- Model selection
- Sync mode: loop, bounce, cut_off, remap, silence
- Temperature
- Active speaker detection
- Occlusion detection
- Supabase URL / Key / Bucket, Save location

## Troubleshooting
- Extension not visible → Ensure PlayerDebugMode is enabled (the install script sets it). Restart Premiere.
- Backend not responding → Port 3000 might be blocked. Quit other apps or restart Premiere (panel auto‑starts backend).
- ProRes preview shows black → Chromium won’t decode ProRes; preview uses H.264.
- Export preset missing → Check files in `epr/` match names in the UI.