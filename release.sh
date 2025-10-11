#!/usr/bin/env bash
set -euo pipefail

# Release script for sync-extensions extension
# Usage: ./release.sh [version] [message]
# Example: ./release.sh 0.7.1 "Switched to ZXP"

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
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
    # Keep Host Version as [24.0,99.9] for both AE and Premiere (don't update)
    # Keep CSXS RequiredRuntime Version as 12.0 for both AE and Premiere (don't update)
    # Restore correct Host and CSXS versions if they were accidentally changed
    sed -i.bak "s/Host Name=\"AEFT\" Version=\"[^\"]*\"/Host Name=\"AEFT\" Version=\"[24.0,99.9]\"/g" "$manifest"
    sed -i.bak "s/Host Name=\"PPRO\" Version=\"[^\"]*\"/Host Name=\"PPRO\" Version=\"[24.0,99.9]\"/g" "$manifest"
    sed -i.bak "s/RequiredRuntime Name=\"CSXS\" Version=\"[^\"]*\"/RequiredRuntime Name=\"CSXS\" Version=\"12.0\"/g" "$manifest"
    # Ensure Host versions in DispatchInfoList are also correct
    sed -i.bak "s/<Host Name=\"AEFT\" Version=\"[^\"]*\"/<Host Name=\"AEFT\" Version=\"[24.0,99.9]\"/g" "$manifest"
    sed -i.bak "s/<Host Name=\"PPRO\" Version=\"[^\"]*\"/<Host Name=\"PPRO\" Version=\"[24.0,99.9]\"/g" "$manifest"
    rm -f "$manifest.bak"
  fi
done


echo "Skipping ZIP packaging. ZXP signing is handled by GitHub Actions on tag push."

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

# GitHub Actions workflow will trigger automatically on tag push
echo "GitHub Actions workflow will trigger automatically on tag push"

# GitHub release will be created automatically by GitHub Actions workflow
echo "GitHub release will be created automatically with signed ZXP packages."

echo "Release $VERSION completed!"
echo "Signed ZXPs will be attached by GitHub Actions on the tag push."
