#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
  echo "=== Installing After Effects Extension ==="
  echo "Installing AE to: $AE_DEST_DIR"
  mkdir -p "$AE_DEST_DIR"
  
  # Copy shared app files
  rsync -a --delete \
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
  mkdir -p "$AE_DEST_DIR/ui"
  cp -f "$AE_SRC_DIR/ui/host-detection.js" "$AE_DEST_DIR/ui/host-detection.js"
  
  # Use AE manifest
  mkdir -p "$AE_DEST_DIR/CSXS"
  cp -f "$AE_SRC_DIR/CSXS/manifest.xml" "$AE_DEST_DIR/CSXS/manifest.xml"
  
  # Install server dependencies
  echo "Installing server dependencies for AE..."
  cd "$AE_DEST_DIR/server"
  
  # Check if Node.js is available
  if ! command -v npm >/dev/null 2>&1; then
    echo "⚠️  Node.js/npm not found. Attempting to install Node.js..."
    
    # Try to install Node.js via Homebrew
    if command -v brew >/dev/null 2>&1; then
      echo "Installing Node.js via Homebrew..."
      if brew install node; then
        echo "✅ Node.js installed successfully"
        # Reload shell environment
        export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
      else
        echo "❌ Failed to install Node.js via Homebrew"
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
    else
      echo "❌ Homebrew not found. Please install Node.js manually:"
      echo "1. Visit https://nodejs.org/"
      echo "2. Download and install the LTS version"
      echo "3. Restart your terminal and run this script again"
      echo ""
      echo "Alternatively, you can install from the release ZIP which doesn't require Node.js:"
      echo "https://github.com/mhadifilms/sync-extensions/releases/latest"
      exit 1
    fi
  fi
  
  echo "Installing AE server dependencies with npm..."
  if ! npm install --omit=dev; then
    echo "ERROR: Failed to install AE server dependencies"
    echo "Please check your Node.js installation and try again"
    echo "You can also try running manually:"
    echo "  cd \"$AE_DEST_DIR/server\""
    echo "  npm install"
    exit 1
  fi
  echo "✅ AE server dependencies installed successfully"
  
  # Verify critical dependencies
  echo "Verifying server dependencies..."
  if [ ! -d "node_modules/node-fetch" ]; then
    echo "ERROR: node-fetch not found in AE server dependencies"
    exit 1
  fi
  
  if [ ! -d "node_modules/express" ]; then
    echo "ERROR: express not found in AE server dependencies"
    exit 1
  fi
  
  if [ ! -d "node_modules/cors" ]; then
    echo "ERROR: cors not found in AE server dependencies"
    exit 1
  fi
  
  echo "✅ All critical dependencies verified for AE"
  
  echo "Checking for ffmpeg…"
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg found"
  else
    if command -v brew >/dev/null 2>&1; then
      echo "Installing ffmpeg via Homebrew…"
      brew install ffmpeg >/tmp/sync_ffmpeg_install.log 2>&1 || true
    else
      echo "Homebrew not found; please install ffmpeg manually (https://ffmpeg.org) for AE transcodes."
    fi
  fi
  
  echo "✅ After Effects extension installed successfully!"
fi

if $PR; then
  echo "=== Installing Premiere Pro Extension ==="
  echo "Installing Premiere to: $PPRO_DEST_DIR"
  mkdir -p "$PPRO_DEST_DIR"
  
  # Copy shared app files
  rsync -a --delete \
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
  mkdir -p "$PPRO_DEST_DIR/ui"
  cp -f "$PPRO_SRC_DIR/ui/host-detection.js" "$PPRO_DEST_DIR/ui/host-detection.js"
  
  # Use PPro manifest
  mkdir -p "$PPRO_DEST_DIR/CSXS"
  cp -f "$PPRO_SRC_DIR/CSXS/manifest.xml" "$PPRO_DEST_DIR/CSXS/manifest.xml"
  
  # Copy EPR files for Premiere
  if [ -d "$PPRO_SRC_DIR/epr" ]; then
    cp -R "$PPRO_SRC_DIR/epr" "$PPRO_DEST_DIR/"
  fi
  
  # Install server dependencies
  echo "Installing server dependencies for Premiere..."
  cd "$PPRO_DEST_DIR/server"
  
  # Check if Node.js is available
  if ! command -v npm >/dev/null 2>&1; then
    echo "⚠️  Node.js/npm not found. Attempting to install Node.js..."
    
    # Try to install Node.js via Homebrew
    if command -v brew >/dev/null 2>&1; then
      echo "Installing Node.js via Homebrew..."
      if brew install node; then
        echo "✅ Node.js installed successfully"
        # Reload shell environment
        export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
      else
        echo "❌ Failed to install Node.js via Homebrew"
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
    else
      echo "❌ Homebrew not found. Please install Node.js manually:"
      echo "1. Visit https://nodejs.org/"
      echo "2. Download and install the LTS version"
      echo "3. Restart your terminal and run this script again"
      echo ""
      echo "Alternatively, you can install from the release ZIP which doesn't require Node.js:"
      echo "https://github.com/mhadifilms/sync-extensions/releases/latest"
      exit 1
    fi
  fi
  
  echo "Installing Premiere server dependencies with npm..."
  if ! npm install --omit=dev; then
    echo "ERROR: Failed to install Premiere server dependencies"
    echo "Please check your Node.js installation and try again"
    echo "You can also try running manually:"
    echo "  cd \"$PPRO_DEST_DIR/server\""
    echo "  npm install"
    exit 1
  fi
  echo "✅ Premiere server dependencies installed successfully"
  
  # Verify critical dependencies
  echo "Verifying server dependencies..."
  if [ ! -d "node_modules/node-fetch" ]; then
    echo "ERROR: node-fetch not found in Premiere server dependencies"
    exit 1
  fi
  
  if [ ! -d "node_modules/express" ]; then
    echo "ERROR: express not found in Premiere server dependencies"
    exit 1
  fi
  
  if [ ! -d "node_modules/cors" ]; then
    echo "ERROR: cors not found in Premiere server dependencies"
    exit 1
  fi
  
  echo "✅ All critical dependencies verified for Premiere"
  
  echo "✅ Premiere Pro extension installed successfully!"
fi

# Enable PlayerDebugMode (only once regardless of how many extensions installed)
if $AE || $PR; then
  echo "Enable PlayerDebugMode (if not already)"
  # Cover a range of CEP versions used by modern Adobe apps
  for v in 10 11 12 13 14; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 || true
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
