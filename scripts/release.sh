#!/usr/bin/env bash
set -euo pipefail

# Helper to tag and create a GitHub release based on CSXS/manifest.xml version
# Requirements:
#  - gh CLI installed and authenticated (gh auth login)
#  - git clean working tree

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$REPO_DIR/CSXS/manifest.xml"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI not found. Install GitHub CLI: https://cli.github.com/" >&2
  exit 1
fi

if ! command -v xmllint >/dev/null 2>&1; then
  echo "Error: xmllint not found (libxml2). Install via brew: brew install libxml2" >&2
  exit 1
fi

ver=$(xmllint --xpath 'string(/ExtensionManifest/@ExtensionBundleVersion)' "$MANIFEST")
if [ -z "$ver" ]; then
  echo "Error: Could not parse version from $MANIFEST" >&2
  exit 1
fi

tag="v$ver"

# Ensure git is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Git working tree not clean. Commit or stash changes first." >&2
  exit 1
fi

# Create tag if missing
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag $tag already exists."
else
  echo "Creating tag $tag"
  git tag -a "$tag" -m "Release $tag"
  git push origin "$tag"
fi

# Create GitHub release if missing
if gh release view "$tag" >/dev/null 2>&1; then
  echo "Release $tag already exists."
else
  echo "Creating GitHub release $tag"
  gh release create "$tag" --title "$tag" --notes "Auto release from manifest version $ver"
fi

echo "Done. Release $tag is published."
