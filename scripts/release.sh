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
# Update root manifest
ROOT_MANIFEST="$REPO_DIR/CSXS/manifest.xml"
if [ -f "$ROOT_MANIFEST" ]; then
  echo "  Updating $ROOT_MANIFEST"
  sed -i.bak "s/ExtensionBundleVersion=\"[^\"]*\"/ExtensionBundleVersion=\"$VERSION\"/g" "$ROOT_MANIFEST"
  rm -f "$ROOT_MANIFEST.bak"
fi

# Update extension manifests
for manifest in "$REPO_DIR/extensions"/*/CSXS/manifest.xml; do
  if [ -f "$manifest" ]; then
    echo "  Updating $manifest"
    # Update ExtensionBundleVersion
    sed -i.bak "s/ExtensionBundleVersion=\"[^\"]*\"/ExtensionBundleVersion=\"$VERSION\"/g" "$manifest"
    # Update Extension Version (increment patch for panel ID) - ONLY for Extension Id, not Host Version
    PATCH_VERSION=$(echo "$VERSION" | cut -d. -f3)
    NEW_PATCH=$((PATCH_VERSION + 1))
    PANEL_VERSION=$(echo "$VERSION" | sed "s/\.[0-9]*$/.$NEW_PATCH/")
    # Update Version in Extension Id lines only, preserve Host Version lines
    sed -i.bak "s/\(<Extension Id=\"[^\"]*\" Version=\"\)[^\"]*\(.*\)/\1$PANEL_VERSION\2/g" "$manifest"
    # Update Host Version for AE (keep Premiere host version as [24.0,99.9])
    if [[ "$manifest" == *"ae-extension"* ]]; then
      sed -i.bak "s/\(<Host Name=\"AEFT\" Version=\"\)[^\"]*\(.*\)/\1$VERSION\2/g" "$manifest"
    fi
    # Update CSXS RequiredRuntime Version for AE (keep Premiere as 12.0)
    if [[ "$manifest" == *"ae-extension"* ]]; then
      sed -i.bak "s/\(<RequiredRuntime Name=\"CSXS\" Version=\"\)[^\"]*\(.*\)/\1$VERSION\2/g" "$manifest"
    fi
    rm -f "$manifest.bak"
  fi
done

# Update root manifest Extension Id versions
if [ -f "$ROOT_MANIFEST" ]; then
  echo "  Updating root manifest Extension Id versions"
  PATCH_VERSION=$(echo "$VERSION" | cut -d. -f3)
  NEW_PATCH=$((PATCH_VERSION + 1))
  PANEL_VERSION=$(echo "$VERSION" | sed "s/\.[0-9]*$/.$NEW_PATCH/")
  # Update Version in Extension Id lines only, preserve Host Version lines
  sed -i.bak "s/\(<Extension Id=\"[^\"]*\" Version=\"\)[^\"]*\(.*\)/\1$PANEL_VERSION\2/g" "$ROOT_MANIFEST"
  rm -f "$ROOT_MANIFEST.bak"
fi

# Build distributable packages (zips) for Mac and Windows
echo "Packaging distributables..."
PKG_DIR="$REPO_DIR/dist/releases/v$VERSION"
mkdir -p "$PKG_DIR"

bundle_os(){
  local os="$1"  # mac or windows
  local os_label="$2"  # macOS or Windows

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  # Create sync-extensions directory in bundle
  local dest="$tmp/sync-extensions"
  mkdir -p "$dest"

  # Copy core project files (include scripts for release ZIPs)
  rsync -a --delete \
    --exclude ".git/" \
    --exclude "dist/" \
    --exclude "node_modules/" \
    --exclude "server/node_modules/" \
    --exclude ".DS_Store" \
    --exclude "*.log" \
    --exclude ".env" \
    --exclude ".vscode/" \
    --exclude "README.md" \
    --exclude ".gitignore" \
    --exclude "scripts/release.sh" \
    "$REPO_DIR/" "$dest/"

  # Platform-specific script filtering
  if [ "$os" = "windows" ]; then
    # Remove .sh scripts for Windows package
    rm -f "$dest/scripts/install.sh"
    rm -f "$dest/scripts/remove.sh"
  else
    # Remove .ps1 scripts for macOS package
    rm -f "$dest/scripts/install.ps1"
    rm -f "$dest/scripts/remove.ps1"
  fi

  # Write platform-specific README
  if [ "$os" = "windows" ]; then
    cat > "$tmp/README.txt" <<EOT
sync. extensions v$VERSION (Windows)
=====================================

QUICK INSTALL (Recommended):
1. Extract this ZIP file
2. Open the extracted "sync-extensions" folder
3. Right-click PowerShell → "Run as Administrator" → Run:
   cd scripts
   powershell -ExecutionPolicy Bypass -File install.ps1
4. Choose which extensions to install (After Effects, Premiere Pro, or both)
5. Restart Adobe applications
6. Open Window → Extensions → "sync. for [App]"

MANUAL INSTALL:
1. Extract this ZIP file
2. Open the extracted "sync-extensions" folder
3. Copy the extension folders to:
   %APPDATA%\\Adobe\\CEP\\extensions\\ (current user only)
4. Enable PlayerDebugMode:
   Set registry key HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.12\\PlayerDebugMode = 1
5. Restart Adobe applications
6. Open Window → Extensions → "sync. for [App]"

TROUBLESHOOTING:
- If extension doesn't appear: Make sure PlayerDebugMode is enabled and restart Adobe app
- If server doesn't start: Install Node.js from https://nodejs.org
- Script will auto-install Node.js via winget, or download from https://nodejs.org
- PowerShell execution policy error: Use the bypass command above, or:
  1. Run PowerShell as Administrator
  2. Run: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
  3. Run: cd scripts && powershell -ExecutionPolicy Bypass -File install.ps1
- Script path error: Make sure you're in the extracted "sync-extensions" folder and run "cd scripts" first
- Extension not showing: Check installation location:
  %APPDATA%\Adobe\CEP\extensions\com.sync.extension.ppro.panel
  Enable PlayerDebugMode: reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_DWORD /d 1 /f

REQUIREMENTS:
- Adobe After Effects 2024 or later (optional)
- Adobe Premiere Pro 2024 or later (optional)
- Node.js (for local server)
- Internet connection (for sync functionality)

For more help, visit: https://github.com/mhadifilms/sync-extensions
EOT
  else
    cat > "$tmp/README.txt" <<EOT
sync. extensions v$VERSION (macOS)
=====================================

QUICK INSTALL (Recommended):
1. Extract this ZIP file
2. Run the install script:
   ./scripts/install.sh
3. Choose which extensions to install (After Effects, Premiere Pro, or both)
4. Restart Adobe applications
5. Open Window → Extensions → "sync. for [App]"

MANUAL INSTALL:
1. Extract this ZIP file
2. Copy the extension folders to:
   ~/Library/Application Support/Adobe/CEP/extensions/
3. Enable PlayerDebugMode:
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
4. Restart Adobe applications
5. Open Window → Extensions → "sync. for [App]"

TROUBLESHOOTING:
- If extension doesn't appear: Make sure PlayerDebugMode is enabled and restart Adobe app
- If server doesn't start: Install Node.js from https://nodejs.org
- Install Homebrew first, then run: brew install node

REQUIREMENTS:
- Adobe After Effects 2024 or later (optional)
- Adobe Premiere Pro 2024 or later (optional)
- Node.js (for local server)
- Internet connection (for sync functionality)

For more help, visit: https://github.com/mhadifilms/sync-extensions
EOT
  fi

  # Create zip
  local out="$PKG_DIR/sync-extensions-$os-v$VERSION.zip"
  (cd "$tmp" && zip -qr "$out" "sync-extensions" README.txt)
  echo "  Created $out"
}

bundle_os "mac" "macOS" || exit 1
bundle_os "windows" "Windows" || exit 1

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
  MAC_ZIP="$PKG_DIR/sync-extensions-mac-v$VERSION.zip"
  WIN_ZIP="$PKG_DIR/sync-extensions-windows-v$VERSION.zip"
  
  # Verify ZIPs exist
  if [ ! -f "$MAC_ZIP" ]; then
    echo "ERROR: Mac ZIP not found: $MAC_ZIP" >&2
    exit 1
  fi
  if [ ! -f "$WIN_ZIP" ]; then
    echo "ERROR: Windows ZIP not found: $WIN_ZIP" >&2
    exit 1
  fi
  
  echo "Uploading assets:"
  echo "  Mac: $MAC_ZIP"
  echo "  Windows: $WIN_ZIP"
  
  if gh release view "v$VERSION" >/dev/null 2>&1; then
    echo "Release exists, uploading assets..."
    if gh release upload "v$VERSION" "$MAC_ZIP" "$WIN_ZIP" --clobber; then
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
      "$MAC_ZIP" "$WIN_ZIP"; then
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
  rm -f "$MAC_ZIP" "$WIN_ZIP"
  rmdir "$PKG_DIR" 2>/dev/null || true
fi

echo "Release $VERSION completed!"
echo "Users can download a zip from the release and install without cloning."
