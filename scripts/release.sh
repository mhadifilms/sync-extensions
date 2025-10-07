#!/usr/bin/env bash
set -euo pipefail

# Release script for sync-extensions extension
# Usage: ./scripts/release.sh [version] [message]
# Example: ./scripts/release.sh 0.4.0 "Added new features"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
MESSAGE="${2:-Release $VERSION}"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [message]"
  echo "Example: $0 0.4.0 'Added new features'"
  exit 1
fi

# Validate version format (semantic versioning)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 0.4.0)"
  exit 1
fi

echo "Releasing version $VERSION..."

# Update manifest files
echo "Updating manifest files..."
for manifest in "$REPO_DIR/extensions"/*/CSXS/manifest.xml; do
  if [ -f "$manifest" ]; then
    echo "  Updating $manifest"
    # Update ExtensionBundleVersion
    sed -i.bak "s/ExtensionBundleVersion=\"[^\"]*\"/ExtensionBundleVersion=\"$VERSION\"/g" "$manifest"
    # Update Extension Version (increment patch for panel ID)
    PATCH_VERSION=$(echo "$VERSION" | cut -d. -f3)
    NEW_PATCH=$((PATCH_VERSION + 1))
    PANEL_VERSION=$(echo "$VERSION" | sed "s/\.[0-9]*$/.$NEW_PATCH/")
    sed -i.bak "s/Version=\"[^\"]*\"/Version=\"$PANEL_VERSION\"/g" "$manifest"
    rm -f "$manifest.bak"
  fi
done

# Build distributable packages (zips) for AE and Premiere
echo "Packaging distributables..."
PKG_DIR="$REPO_DIR/dist/releases/v$VERSION"
mkdir -p "$PKG_DIR"

bundle_one(){
  local host_dir="$1" # ae-extension or premiere-extension
  local ext_id="$2"   # com.sync.extension.ae.panel or com.sync.extension.ppro.panel
  local label="$3"    # AE or PPro label for filename
  local lc_label
  lc_label=$(printf '%s' "$label" | tr '[:upper:]' '[:lower:]')

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  # Destination extension root in bundle
  local dest="$tmp/$ext_id"
  mkdir -p "$dest"

  # Copy core project files (include scripts for release ZIPs)
  rsync -a --delete \
    --exclude ".git/" \
    --exclude "dist/" \
    --exclude "extensions/" \
    --exclude "CSXS/" \
    "$REPO_DIR/" "$dest/"

  # Overlay host-detection + manifest
  mkdir -p "$dest/ui" "$dest/CSXS"
  cp -f "$REPO_DIR/extensions/$host_dir/ui/host-detection.js" "$dest/ui/host-detection.js"
  cp -f "$REPO_DIR/extensions/$host_dir/CSXS/manifest.xml" "$dest/CSXS/manifest.xml"

  # Install server deps (production-only)
  if [ -d "$dest/server" ]; then
    echo "  Installing server deps for $label..."
    (cd "$dest/server" && npm install --omit=dev >/dev/null 2>&1)
    # Verify critical dependency
    if [ ! -d "$dest/server/node_modules/node-fetch" ]; then
      echo "  ERROR: node-fetch missing in $label server deps" >&2
      return 1
    fi
  fi

  # Write README for bundle
  cat > "$tmp/README.txt" <<EOT
sync. extension ($label) v$VERSION

Install (macOS):
  - Unzip and copy the folder "$ext_id" to:
    ~/Library/Application Support/Adobe/CEP/extensions/
  - Or run: ./scripts/install.sh --$lc_label

Install (Windows):
  - Unzip and copy the folder "$ext_id" to:
    %APPDATA%\\Adobe\\CEP\\extensions\\  (for current user)
    or %ProgramData%\\Adobe\\CEP\\extensions\\ (for all users)
  - Or run: powershell -ExecutionPolicy Bypass -File scripts\\install.ps1 -App $lc_label

After install, restart Adobe app and open Window → Extensions → sync.

Note: If the extension doesn't appear, enable PlayerDebugMode:
  macOS: defaults write com.adobe.CSXS.11 PlayerDebugMode 1
  Windows: Set registry key HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.11\\PlayerDebugMode = 1
EOT

  # Create zip
  local out="$PKG_DIR/sync-extension-$lc_label-v$VERSION.zip"
  (cd "$tmp" && zip -qr "$out" "$ext_id" README.txt)
  echo "  Created $out"
}

bundle_one "ae-extension" "com.sync.extension.ae.panel" "AE" || exit 1
bundle_one "premiere-extension" "com.sync.extension.ppro.panel" "premiere" || exit 1

# Commit changes
echo "Committing changes..."
cd "$REPO_DIR"
git add extensions/*/CSXS/manifest.xml
git commit -m "Bump version to $VERSION" || echo "No changes to commit"

# Create git tag
echo "Creating git tag..."
git tag -a "v$VERSION" -m "$MESSAGE" || echo "Tag exists; continuing"

# Push to GitHub
echo "Pushing to GitHub..."
git push origin main || true
git push origin "v$VERSION" || true

# Create GitHub release with assets
echo "Creating GitHub release..."
if command -v gh >/dev/null 2>&1; then
  AE_ZIP=$(ls "$PKG_DIR"/sync-extension-ae-v$VERSION.zip 2>/dev/null || true)
  PR_ZIP=$(ls "$PKG_DIR"/sync-extension-premiere-v$VERSION.zip 2>/dev/null || true)
  if gh release view "v$VERSION" >/dev/null 2>&1; then
    gh release upload "v$VERSION" "$AE_ZIP" "$PR_ZIP" --clobber
  else
    gh release create "v$VERSION" \
      --title "Release $VERSION" \
      --notes "$MESSAGE" \
      --target main \
      "$AE_ZIP" "$PR_ZIP"
  fi
  echo "GitHub release created/updated with assets!"
else
  echo "GitHub CLI not found. Please upload zips manually:"
  echo "  $PKG_DIR"
  echo "Create release: https://github.com/mhadifilms/sync-extensions/releases/new?tag=v$VERSION"
fi

echo "Release $VERSION completed!"
echo "Users can download a zip from the release and install without cloning."
