#!/usr/bin/env bash
set -euo pipefail

EXT_ID="com.sync.extension.panel"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

if [ -d "$DEST_DIR" ]; then
  echo "Removing $DEST_DIR"
  rm -rf "$DEST_DIR"
else
  echo "No install found at $DEST_DIR"
fi

echo "Done."

