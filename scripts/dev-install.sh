EXT_ID="com.sync.extension.panel"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/$EXT_ID"

echo "Installing to: $DEST_DIR"
mkdir -p "$DEST_DIR"
rsync -a --delete \
  --exclude ".git/" \
  --exclude "dist/" \
  "$SRC_DIR/" "$DEST_DIR/"

echo "Enable PlayerDebugMode (if not already)"
# Cover a range of CEP versions used by modern Adobe apps
for v in 10 11 12 13 14; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 || true
done

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

echo "Installed. Open Window > Extensions > sync. extension in Premiere or After Effects"

