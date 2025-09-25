#!/usr/bin/env bash
set -euo pipefail

# Package and sign the CEP extension into a ZXP
# Requirements:
#  - ZXPSignCmd installed (put it on PATH or set ZXPSIGNCMD env var)
#  - A signing certificate (P12). If you don't have one, this script can create a self-signed cert
#  - macOS: run `chmod +x scripts/package-zxp.sh` and execute from repo root

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_DIR/dist"
STAGE_DIR="$DIST_DIR/stage"
CERT_DIR="$REPO_DIR/certs"
MANIFEST="$REPO_DIR/CSXS/manifest.xml"
ZXPSIGNCMD_BIN="${ZXPSIGNCMD:-ZXPSignCmd}"

mkdir -p "$DIST_DIR" "$CERT_DIR" "$STAGE_DIR"

# Read values from manifest
bundle_id=$(xmllint --xpath 'string(/ExtensionManifest/@ExtensionBundleId)' "$MANIFEST")
bundle_ver=$(xmllint --xpath 'string(/ExtensionManifest/@ExtensionBundleVersion)' "$MANIFEST")
panel_id=$(xmllint --xpath 'string(/ExtensionManifest/DispatchInfoList/Extension/@Id)' "$MANIFEST")

zxp_name="${bundle_id}-${bundle_ver}.zxp"
zxp_out="$DIST_DIR/$zxp_name"

# Certificate defaults (you can override via env vars)
COUNTRY_CODE=${COUNTRY_CODE:-US}
STATE=${STATE:-CA}
CITY=${CITY:-San Francisco}
ORG=${ORG:-Sync}
ORG_UNIT=${ORG_UNIT:-Extensions}
EMAIL=${EMAIL:-support@sync.so}
CERT_P12=${CERT_P12:-$CERT_DIR/sync-extension.p12}
CERT_PASS=${CERT_PASS:-sync123}

if ! command -v "$ZXPSIGNCMD_BIN" >/dev/null 2>&1; then
  echo "Error: ZXPSignCmd not found. Install it and set ZXPSIGNCMD env var if needed." >&2
  echo "Download: https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCmd" >&2
  exit 1
fi

# Create certificate if missing
if [ ! -f "$CERT_P12" ]; then
  echo "Creating self-signed certificate at $CERT_P12"
  "$ZXPSIGNCMD_BIN" -selfSignedCert "$COUNTRY_CODE" "$STATE" "$CITY" "$ORG" "$ORG_UNIT" "$EMAIL" "$CERT_PASS" "$CERT_P12"
fi

echo "Staging clean extension contents…"
rsync -a --delete \
  --exclude ".git/" \
  --exclude "dist/" \
  --exclude "scripts/" \
  --exclude "**/.DS_Store" \
  --exclude "README.md" \
  "$REPO_DIR/" "$STAGE_DIR/"

echo "Signing extension -> $zxp_out"
"$ZXPSIGNCMD_BIN" -sign "$STAGE_DIR" "$zxp_out" "$CERT_P12" "$CERT_PASS" -tsa http://timestamp.digicert.com

echo "Done: $zxp_out"

