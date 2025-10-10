## Debugging and Logs

### Base directory
All runtime files (logs, state, cache, outputs, updates) are stored per‑user under the app data folder named `sync. extensions`.

- macOS: `~/Library/Application Support/sync. extensions`
- Windows: `%APPDATA%\sync. extensions`

Subfolders created on demand:
- `logs/`
- `cache/`
- `state/`
- `outputs/`
- `updates/`

### Enabling debug logs (simple flag file)
Debug logging is disabled by default. Enable it by creating a flag file:

- Create an empty file `logs/debug.enabled` inside the base directory.

Disable by removing `logs/debug.enabled`.

### Log file locations
When enabled, components write to the `logs/` directory:
- After Effects host: `logs/sync_ae_debug.log`
- Premiere host: `logs/sync_ppro_debug.log`
- UI auto‑start: `logs/sync_nle_autostart.log`
- UI actions: `logs/sync_save_debug.log`, `logs/sync_insert_debug.log`
- Local server: `logs/sync_ae_debug.log` (server prefix)

Note: Without the flag file, UI and host log files are not written.

### Quick start (macOS)
```bash
mkdir -p ~/Library/Application\ Support/sync.\ extensions/logs
touch ~/Library/Application\ Support/sync.\ extensions/logs/debug.enabled
```

### Quick start (Windows / PowerShell)
```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\sync. extensions\logs" | Out-Null
New-Item -ItemType File -Force "$env:APPDATA\sync. extensions\logs\debug.enabled" | Out-Null
```
### Disable logs
- MacOS: `rm -f ~/Library/Application\ Support/sync.\ extensions/logs/debug.enabled`
- Windows: `Remove-Item -Force "$env:APPDATA\sync. extensions\logs\debug.enabled"`

### Outputs and temporary files
- Transient render/transcode outputs are written under `outputs/`.
- Temporary copies (e.g., of macOS `TemporaryItems`) are kept in `cache/`.

### Troubleshooting
- If you don’t see logs, create `logs/debug.enabled` and retry.
- Confirm the resolved base directory exists and contains the subfolders listed above.

