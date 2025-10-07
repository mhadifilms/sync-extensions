#!/usr/bin/env bash
set -euo pipefail

# Release script for sync-premiere extension
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

# Commit changes
echo "Committing changes..."
cd "$REPO_DIR"
git add extensions/*/CSXS/manifest.xml
git commit -m "Bump version to $VERSION" || echo "No changes to commit"

# Create git tag
echo "Creating git tag..."
git tag -a "v$VERSION" -m "$MESSAGE"

# Push to GitHub
echo "Pushing to GitHub..."
git push origin main
git push origin "v$VERSION"

# Create GitHub release
echo "Creating GitHub release..."
if command -v gh >/dev/null 2>&1; then
  gh release create "v$VERSION" \
    --title "Release $VERSION" \
    --notes "$MESSAGE" \
    --target main
  echo "GitHub release created successfully!"
else
  echo "GitHub CLI not found. Please create release manually at:"
  echo "https://github.com/mhadifilms/sync-premiere/releases/new?tag=v$VERSION"
fi

echo "Release $VERSION completed!"
echo "Users can now update their extensions using the 'check updates' button."
