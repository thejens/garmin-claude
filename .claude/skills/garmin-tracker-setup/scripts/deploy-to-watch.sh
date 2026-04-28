#!/usr/bin/env bash
# Copy the built .prg to the watch.
# Handles both USB mass storage (automatic) and MTP mode (libmtp or manual).
#
# Usage: deploy-to-watch.sh <device>

DEVICE="${1:?device required (e.g. fr965)}"
PRG="watch/build/tracker-${DEVICE}.prg"

if [ ! -f "$PRG" ]; then
  echo "ERROR: $PRG not found — run 'make watch-build DEVICE=$DEVICE' first" >&2
  exit 1
fi

# Detect how the watch is connected (capture output and exit code separately)
DETECT=$(bash .claude/skills/garmin-tracker-setup/scripts/detect-watch-mount.sh 2>/dev/null); EXIT_CODE=$?

# ── Mass storage mode ────────────────────────────────────────────────────────
if [ "$EXIT_CODE" -eq 0 ]; then
  MOUNT=$(echo "$DETECT" | awk '{print $2}')
  APPS_DIR="$MOUNT/GARMIN/APPS"
  mkdir -p "$APPS_DIR"
  cp "$PRG" "$APPS_DIR/"

  SRC_SIZE=$(wc -c < "$PRG" | tr -d ' ')
  DST_SIZE=$(wc -c < "$APPS_DIR/tracker-${DEVICE}.prg" | tr -d ' ')
  if [ "$SRC_SIZE" != "$DST_SIZE" ]; then
    echo "ERROR: size mismatch after copy ($SRC_SIZE vs $DST_SIZE bytes)" >&2
    exit 1
  fi

  echo "Deployed: $APPS_DIR/tracker-${DEVICE}.prg ($SRC_SIZE bytes)"
  echo "Safely eject the watch before unplugging."
  exit 0
fi

# ── MTP mode — use mtp-send-to-apps.py (libmtp + ctypes) ────────────────────
if [ "$EXIT_CODE" -eq 2 ]; then
  ABS_PRG="$(cd "$(dirname "$PRG")" && pwd)/$(basename "$PRG")"
  SCRIPT="$(cd "$(dirname "$0")" && pwd)/mtp-send-to-apps.py"

  if ! command -v mtp-detect &>/dev/null; then
    echo "libmtp not installed. Install with: brew install libmtp" >&2
    echo "Then re-run this step." >&2
    exit 1
  fi

  echo "Watch in MTP mode — deploying via libmtp..."
  python3 "$SCRIPT" "$ABS_PRG" "tracker-${DEVICE}.prg"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    echo "Eject the watch before unplugging."
  fi
  exit "$RC"
fi

# ── Not connected ─────────────────────────────────────────────────────────────
cat <<NOT_CONNECTED

Watch not detected. Please:

  1. Connect the watch to your Mac via USB
  2. On the watch, choose the USB connection mode:
       • "USB Storage" / "File Transfer" / "Garmin Drive"  →  automatic copy
       • MTP mode (for OpenMTP)  →  OpenMTP copy required
  3. Quit Garmin Express completely if it is running
  4. Run this step again

NOT_CONNECTED
exit 1
