#!/usr/bin/env bash
# Detect a connected Garmin watch and determine how it is accessible.
#
# Exit codes and stdout:
#   0  STORAGE <path>   — mounted as USB mass storage; path is the root
#   2  MTP              — connected in MTP mode (libmtp can see it, no /Volumes mount)
#   1  NOT_CONNECTED    — no Garmin USB device found at all

# ── 1. USB mass storage (/Volumes/GARMIN or variants) ────────────────────────
for candidate in /Volumes/GARMIN /Volumes/Garmin /Volumes/garmin; do
  if [ -d "$candidate" ]; then
    echo "STORAGE $candidate"
    exit 0
  fi
done

OTHER=$(ls /Volumes/ 2>/dev/null \
  | grep -iE "^(garmin|forerunner|fenix|venu|epix)" \
  | head -1)
if [ -n "$OTHER" ]; then
  echo "STORAGE /Volumes/$OTHER"
  exit 0
fi

# Linux udev paths
for base in /run/media /media; do
  if [ -d "$base/$USER/GARMIN" ]; then
    echo "STORAGE $base/$USER/GARMIN"
    exit 0
  fi
done

# ── 2. MTP mode — use mtp-detect (most reliable, avoids system_profiler quirks) ──
if command -v mtp-detect &>/dev/null; then
  if mtp-detect 2>/dev/null | grep -qi "garmin\|0x091e"; then
    echo "MTP"
    exit 2
  fi
fi

echo "NOT_CONNECTED"
exit 1
