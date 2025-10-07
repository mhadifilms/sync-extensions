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
    # Update Extension Version (increment patch for panel ID) - ONLY for Extension Id, not Host Version
    PATCH_VERSION=$(echo "$VERSION" | cut -d. -f3)
    NEW_PATCH=$((PATCH_VERSION + 1))
    PANEL_VERSION=$(echo "$VERSION" | sed "s/\.[0-9]*$/.$NEW_PATCH/")
    # Only update Version in Extension Id lines, preserve Host Version lines
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
  trap 'rm -rf "$tmp"' RETURN

  # Destination extension root in bundle
  local dest="$tmp/$ext_id"
  mkdir -p "$dest"

  # Copy core project files (include scripts for release ZIPs)
  rsync -a --delete \
    --exclude ".git/" \
    --exclude "dist/" \
    --exclude "extensions/" \
    --exclude "CSXS/" \
    --exclude "README.md" \
    --exclude ".DS_Store" \
    "$REPO_DIR/" "$dest/"

  # Overlay host-detection + manifest
  mkdir -p "$dest/ui" "$dest/CSXS"
  cp -f "$REPO_DIR/extensions/$host_dir/ui/host-detection.js" "$dest/ui/host-detection.js"
  cp -f "$REPO_DIR/extensions/$host_dir/CSXS/manifest.xml" "$dest/CSXS/manifest.xml"
  
  # Copy EPR files only for Premiere
  if [ "$host_dir" = "premiere-extension" ] && [ -d "$REPO_DIR/extensions/$host_dir/epr" ]; then
    cp -R "$REPO_DIR/extensions/$host_dir/epr" "$dest/"
  fi

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
=====================================

QUICK INSTALL (Recommended):
1. Extract this ZIP file
2. Run the install script:
   macOS: ./scripts/install.sh --$lc_label
   Windows: Right-click PowerShell → "Run as Administrator" → Run:
           .\\scripts\\install.ps1 -App $lc_label
3. Restart Adobe $label
4. Open Window → Extensions → "sync. for $label"

MANUAL INSTALL:
1. Extract this ZIP file
2. Copy the "$ext_id" folder to:
   macOS: ~/Library/Application Support/Adobe/CEP/extensions/
   Windows: %APPDATA%\\Adobe\\CEP\\extensions\\ (current user)
          or %ProgramData%\\Adobe\\CEP\\extensions\\ (all users)
3. Enable PlayerDebugMode:
   macOS: defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   Windows: Set registry key HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.12\\PlayerDebugMode = 1
4. Restart Adobe $label
5. Open Window → Extensions → "sync. for $label"

TROUBLESHOOTING:
- If extension doesn't appear: Make sure PlayerDebugMode is enabled and restart Adobe app
- If server doesn't start: Install Node.js from https://nodejs.org
- macOS: Install Homebrew first, then run: brew install node
- Windows: Script will auto-install Node.js via winget, or download from https://nodejs.org
- Windows PowerShell error: Run PowerShell as Administrator:
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

REQUIREMENTS:
- Adobe $label 2024 or later
- Node.js (for local server)
- Internet connection (for sync functionality)

For more help, visit: https://github.com/mhadifilms/sync-extensions
EOT

  # Create zip
  local out="$PKG_DIR/sync-extension-$lc_label-v$VERSION.zip"
  (cd "$tmp" && zip -qr "$out" "$ext_id" README.txt)
  echo "  Created $out"
}

bundle_one "ae-extension" "com.sync.extension.ae.panel" "AE" || exit 1
bundle_one "premiere-extension" "com.sync.extension.ppro.panel" "Premiere" || exit 1

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
  # Check GitHub CLI authentication
  if ! gh auth status >/dev/null 2>&1; then
    echo "❌ GitHub CLI not authenticated. Run: gh auth login" >&2
    exit 1
  fi
  AE_ZIP="$PKG_DIR/sync-extension-ae-v$VERSION.zip"
  PR_ZIP="$PKG_DIR/sync-extension-premiere-v$VERSION.zip"
  
  # Verify ZIPs exist
  if [ ! -f "$AE_ZIP" ]; then
    echo "ERROR: AE ZIP not found: $AE_ZIP" >&2
    exit 1
  fi
  if [ ! -f "$PR_ZIP" ]; then
    echo "ERROR: Premiere ZIP not found: $PR_ZIP" >&2
    exit 1
  fi
  
  echo "Uploading assets:"
  echo "  AE: $AE_ZIP"
  echo "  Premiere: $PR_ZIP"
  
  if gh release view "v$VERSION" >/dev/null 2>&1; then
    echo "Release exists, uploading assets..."
    if gh release upload "v$VERSION" "$AE_ZIP" "$PR_ZIP" --clobber; then
      echo "✅ Assets uploaded successfully!"
    else
      echo "❌ Failed to upload assets" >&2
      exit 1
    fi
  else
    echo "Creating new release with assets..."
    if gh release create "v$VERSION" \
      --title "Release $VERSION" \
      --notes "$MESSAGE" \
      --target main \
      "$AE_ZIP" "$PR_ZIP"; then
      echo "✅ GitHub release created with assets!"
    else
      echo "❌ Failed to create release" >&2
      exit 1
    fi
  fi
  
  # Verify upload
  echo "Verifying upload..."
  if gh release view "v$VERSION" --json assets --jq '.assets | length' | grep -q "2"; then
    echo "✅ Both assets verified on GitHub!"
  else
    echo "❌ Asset verification failed" >&2
    exit 1
  fi
else
  echo "GitHub CLI not found. Please upload zips manually:"
  echo "  $PKG_DIR"
  echo "Create release: https://github.com/mhadifilms/sync-extensions/releases/new?tag=v$VERSION"
fi

# Cleanup local ZIPs after successful upload
if command -v gh >/dev/null 2>&1; then
  echo "Cleaning up local ZIPs..."
  rm -f "$AE_ZIP" "$PR_ZIP"
  rmdir "$PKG_DIR" 2>/dev/null || true
fi

echo "Release $VERSION completed!"
echo "Users can download a zip from the release and install without cloning."
