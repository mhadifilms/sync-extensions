# sync. extension for Adobe Premiere Pro (CEP)

## Overview

This CEP panel integrates Premiere Pro with Sync.so Lipsync. It provides a simple end‑to‑end workflow:

- Select local video/audio on the Sources tab, or render timeline In/Out directly from Premiere
- Get a cost estimate instantly
- Create a lipsync job via a local Node backend
- Track job progress on the History tab and insert/save the result

## Key Features

- Strict type filters for local selection
- Timeline In/Out export (Premiere direct exporter) using bundled presets in `epr/`
  - Video: H.264 Match Source, ProRes 422 (422 / Proxy / LT / HQ)
  - Audio: WAV (timeline sample rate/channels), MP3 320 kbps
- Immediate Supabase upload on selection (≤1 GB) to power cost estimates and jobs
- Cost estimate auto-badge and row under preview
- Insert at targeted track, save to `sync. outputs` bin
- 1 GB hard limit enforced client and server

## Settings

- Model: lipsync‑2‑pro, lipsync‑2, lipsync‑1.9.0‑beta
- Temperature: default 0.5
- Active speaker detection (auto_detect)
- Occlusion detection enabled
- Sync mode: loop, bounce, cut_off, remap, silence
- Supabase URL / Key / Bucket (public read policy required), Save Location

## Cost Flow

- On selecting video/audio (or using In/Out), the panel uploads both to Supabase and calls:

POST /v2/analyze/cost
{
  "model": "<selected>",
  "input": [{"type":"video","url":"…"},{"type":"audio","url":"…"}],
  "options": {
    "sync_mode": "<selected>",
    "temperature": <slider>,
    "active_speaker_detection": {"auto_detect": true|false},
    "occlusion_detection_enabled": true|false
  }
}

- The backend normalizes the response to an array. The panel shows `cost: $X.XX`.

## Job Flow

- Panel sends either URLs (preferred) or file paths; server supports both.
- Server create generate body includes the same `options` shape as above.
- Temp In/Out files are deleted after upload (kept on error).

## Development

- Repo path: `/Users/livestream/Documents/GitHub/sync-premiere`
- Deployed CEP folder: `/Users/livestream/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel/`
- Sync repo to extension:
`rsync -av --delete --exclude 'server/node_modules' '/Users/livestream/Documents/GitHub/sync-premiere/' '/Users/livestream/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel/'`
- Restart backend:
`bash -lc 'lsof -tiTCP:3000 | xargs -r kill -9; cd "/Users/livestream/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel/server" && nohup node src/server.js > /tmp/sync_extension_server.log 2>&1 & disown'`
- Inspect logs: http://127.0.0.1:3000/logs
- Health: http://127.0.0.1:3000/health

## Troubleshooting

- Cost shows n/a → verify API key and Supabase settings, then check `/logs` for `[costs]` lines.
- Preset not found in `/epr` → confirm exact preset filenames exist.
- EPERM on export → exports go next to the project or `~/Documents/sync_extension_temp`.
- Old server code → free port 3000 and restart as above.
- ProRes preview in panel → Chromium cannot decode ProRes; preview uses H.264 only.