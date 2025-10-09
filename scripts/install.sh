#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Progress bar functions
show_progress() {
    local current=$1
    local total=$2
    local message=$3
    local width=50
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    printf "\r["
    printf "%*s" $filled | tr ' ' '='
    printf "%*s" $empty | tr ' ' ' '
    printf "] %d%% %s" $percentage "$message"
}

hide_output() {
    "$@" > /dev/null 2>&1
}

echo "sync. Extension Installer"
echo "========================"
echo ""

usage(){
  cat <<EOF
Usage: $(basename "$0") [--ae] [--premiere] [--both]

If no flags are given, you'll be prompted to choose.

Flags:
  --ae        Install After Effects extension only
  --premiere  Install Premiere Pro extension only
  --both      Install both (quick dev)
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
  echo "What to install?"
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

# Calculate total steps
TOTAL_STEPS=0
if $AE; then TOTAL_STEPS=$((TOTAL_STEPS + 6)); fi
if $PR; then TOTAL_STEPS=$((TOTAL_STEPS + 6)); fi
CURRENT_STEP=0

show_progress $CURRENT_STEP $TOTAL_STEPS "Starting installation..."

ROOT_DIR="$(dirname "$SCRIPT_DIR")"
AE_EXT_ID="com.sync.extension.ae.panel"
PPRO_EXT_ID="com.sync.extension.ppro.panel"

# Detect if we're running from a release zip or repo
if [ -d "$ROOT_DIR/extensions" ]; then
  # Running from repo structure
  AE_SRC_DIR="$ROOT_DIR/extensions/ae-extension"
  PPRO_SRC_DIR="$ROOT_DIR/extensions/premiere-extension"
else
  # Running from release zip - use extensions directory
  AE_SRC_DIR="$ROOT_DIR/extensions/ae-extension"
  PPRO_SRC_DIR="$ROOT_DIR/extensions/premiere-extension"
fi

AE_DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$AE_EXT_ID"
PPRO_DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$PPRO_EXT_ID"

# Remove legacy single-bundle extension to avoid confusion
LEGACY_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel"
if [ -d "$LEGACY_DIR" ]; then
  echo "Removing legacy extension: $LEGACY_DIR"
  rm -rf "$LEGACY_DIR"
fi

if $AE; then
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Preparing After Effects extension..."
  mkdir -p "$AE_DEST_DIR"
  
  # Copy shared app files
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Copying extension files..."
  hide_output rsync -a --delete \
    --exclude ".git/" \
    --exclude "dist/" \
    --exclude "extensions/" \
    --exclude "scripts/" \
    --exclude "CSXS/" \
    --exclude "node_modules/" \
    --exclude "server/node_modules/" \
    --exclude ".DS_Store" \
    --exclude "*.log" \
    --exclude ".env" \
    --exclude ".vscode/" \
    "$ROOT_DIR/" "$AE_DEST_DIR/"
  
  # Overwrite host-detection with AE-specific
  hide_output mkdir -p "$AE_DEST_DIR/ui"
  hide_output cp -f "$AE_SRC_DIR/ui/host-detection.js" "$AE_DEST_DIR/ui/host-detection.js"
  
  # Use AE manifest
  hide_output mkdir -p "$AE_DEST_DIR/CSXS"
  hide_output cp -f "$AE_SRC_DIR/CSXS/manifest.xml" "$AE_DEST_DIR/CSXS/manifest.xml"
  
  # Install server dependencies
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Installing server dependencies..."
  cd "$AE_DEST_DIR/server"
  
  # Check if Node.js is available
  if ! command -v npm >/dev/null 2>&1; then
    echo ""
    echo "❌ Node.js not found!"
    echo ""
    echo "Please install Node.js manually:"
    echo "1. Visit https://nodejs.org/"
    echo "2. Download and install the LTS version"
    echo "3. Restart your terminal and run this script again"
    echo ""
    echo "Alternatively, you can install from the release ZIP which doesn't require Node.js:"
    echo "https://github.com/mhadifilms/sync-extensions/releases/latest"
    exit 1
  fi
  
  if ! hide_output npm install --omit=dev; then
    echo ""
    echo "❌ Failed to install server dependencies"
    echo "Please check your Node.js installation and try again"
    exit 1
  fi
  
  # Verify critical dependencies
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Verifying dependencies..."
  if [ ! -d "node_modules/node-fetch" ] || [ ! -d "node_modules/express" ] || [ ! -d "node_modules/cors" ]; then
    echo ""
    echo "❌ Critical dependencies missing"
    exit 1
  fi
  
  # Test server startup
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Testing server startup..."
  if ! timeout 5s node src/server.js > /dev/null 2>&1; then
    echo ""
    echo "⚠️  Server startup test failed - this may indicate a dependency issue"
  fi
  
  # Check for ffmpeg
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Checking ffmpeg..."
  if ! command -v ffmpeg >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      hide_output brew install ffmpeg || true
    fi
  fi
fi

if $PR; then
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Preparing Premiere Pro extension..."
  mkdir -p "$PPRO_DEST_DIR"
  
  # Copy shared app files
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Copying extension files..."
  hide_output rsync -a --delete \
    --exclude ".git/" \
    --exclude "dist/" \
    --exclude "extensions/" \
    --exclude "scripts/" \
    --exclude "CSXS/" \
    --exclude "node_modules/" \
    --exclude "server/node_modules/" \
    --exclude ".DS_Store" \
    --exclude "*.log" \
    --exclude ".env" \
    --exclude ".vscode/" \
    "$ROOT_DIR/" "$PPRO_DEST_DIR/"
  
  # Overwrite host-detection with PPro-specific
  hide_output mkdir -p "$PPRO_DEST_DIR/ui"
  hide_output cp -f "$PPRO_SRC_DIR/ui/host-detection.js" "$PPRO_DEST_DIR/ui/host-detection.js"
  
  # Use PPro manifest
  hide_output mkdir -p "$PPRO_DEST_DIR/CSXS"
  hide_output cp -f "$PPRO_SRC_DIR/CSXS/manifest.xml" "$PPRO_DEST_DIR/CSXS/manifest.xml"
  
  # Copy EPR files for Premiere
  if [ -d "$PPRO_SRC_DIR/epr" ]; then
    hide_output cp -R "$PPRO_SRC_DIR/epr" "$PPRO_DEST_DIR/"
  fi
  
  # Install server dependencies
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Installing server dependencies..."
  cd "$PPRO_DEST_DIR/server"
  
  # Check if Node.js is available
  if ! command -v npm >/dev/null 2>&1; then
    echo ""
    echo "❌ Node.js not found!"
    echo ""
    echo "Please install Node.js manually:"
    echo "1. Visit https://nodejs.org/"
    echo "2. Download and install the LTS version"
    echo "3. Restart your terminal and run this script again"
    echo ""
    echo "Alternatively, you can install from the release ZIP which doesn't require Node.js:"
    echo "https://github.com/mhadifilms/sync-extensions/releases/latest"
    exit 1
  fi
  
  if ! hide_output npm install --omit=dev; then
    echo ""
    echo "❌ Failed to install server dependencies"
    echo "Please check your Node.js installation and try again"
    exit 1
  fi
  
  # Verify critical dependencies
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Verifying dependencies..."
  if [ ! -d "node_modules/node-fetch" ] || [ ! -d "node_modules/express" ] || [ ! -d "node_modules/cors" ]; then
    echo ""
    echo "❌ Critical dependencies missing"
    exit 1
  fi
  
  # Test server startup
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Testing server startup..."
  if ! timeout 5s node src/server.js > /dev/null 2>&1; then
    echo ""
    echo "⚠️  Server startup test failed - this may indicate a dependency issue"
  fi
fi

# Enable PlayerDebugMode (only once regardless of how many extensions installed)
if $AE || $PR; then
  CURRENT_STEP=$((CURRENT_STEP + 1))
  show_progress $CURRENT_STEP $TOTAL_STEPS "Enabling debug mode..."
  # Cover a range of CEP versions used by modern Adobe apps
  for v in 10 11 12 13 14; do
    hide_output defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 || true
  done
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "To use:"
if $AE; then
  echo "• After Effects: Window > Extensions > 'sync. for After Effects'"
fi
if $PR; then
  echo "• Premiere Pro: Window > Extensions > 'sync. for Premiere'"
fi
echo ""
echo "Note: Restart Adobe applications to see the extensions."
