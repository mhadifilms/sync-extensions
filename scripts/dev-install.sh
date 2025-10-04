#!/usr/bin/env bash
set -euo pipefail

# Unsigned developer install (macOS)
# Copies the extension folder into the CEP extensions directory

EXT_ID="com.sync.extension.panel"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

echo "Installing to: $DEST_DIR"
mkdir -p "$DEST_DIR"
rsync -a --delete \
  --exclude ".git/" \
  --exclude "dist/" \
  "$SRC_DIR/" "$DEST_DIR/"

echo "Enable PlayerDebugMode (if not already)"
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 || true
defaults write com.adobe.CSXS.13 PlayerDebugMode 1 || true

echo "Done. Launch Premiere Pro and open Window > Extensions > sync. extension"

