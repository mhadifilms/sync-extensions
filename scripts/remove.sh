#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage(){
  cat <<EOF
Usage: $(basename "$0") [--ae] [--premiere] [--both]

If no flags are given, you'll be prompted to choose.

Flags:
  --ae        Remove After Effects extension only
  --premiere  Remove Premiere Pro extension only
  --both      Remove both extensions
EOF
}

AE=false
PR=false

case "${1-}" in
  --ae) AE=true ;;
  --premiere) PR=true ;;
  --both) AE=true; PR=true ;;
  -h|--help) usage; exit 0 ;;
  "") ;;
  *) usage; exit 1 ;;
esac

if ! $AE && ! $PR; then
  echo "What to remove?"
  echo "  1) After Effects"
  echo "  2) Premiere Pro"
  echo "  3) Both"
  read -r -p "Choose [1-3]: " CH
  case "$CH" in
    1) AE=true ;;
    2) PR=true ;;
    3) AE=true; PR=true ;;
    *) echo "Invalid choice"; exit 1 ;;
  esac
fi

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"

if $AE; then
  echo "=== Removing After Effects Extension ==="
  AE_EXT_DIR="$EXT_DIR/com.sync.extension.ae.panel"
  if [ -d "$AE_EXT_DIR" ]; then
    rm -rf "$AE_EXT_DIR"
    echo "✅ After Effects extension removed successfully"
  else
    echo "ℹ️  After Effects extension not found (already removed)"
  fi
fi

if $PR; then
  echo "=== Removing Premiere Pro Extension ==="
  PPRO_EXT_DIR="$EXT_DIR/com.sync.extension.ppro.panel"
  if [ -d "$PPRO_EXT_DIR" ]; then
    rm -rf "$PPRO_EXT_DIR"
    echo "✅ Premiere Pro extension removed successfully"
  else
    echo "ℹ️  Premiere Pro extension not found (already removed)"
  fi
fi

echo ""
echo "✅ Removal complete!"
echo ""
echo "Note: Restart Adobe applications to see changes."