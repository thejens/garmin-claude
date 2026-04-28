#!/usr/bin/env bash
# Try to identify the CIQ device ID from a mounted GARMIN volume.
#
# Exit 0 + prints CIQ device ID (e.g. "fr965") on success.
# Exit 1 + prints "UNKNOWN" or "UNKNOWN:<raw description>" if cannot determine.
#
# Only works in USB mass storage mode — MTP mode has no accessible filesystem.
# Usage: detect-device.sh [mount_path]

MOUNT="${1:-/Volumes/GARMIN}"

if [ ! -d "$MOUNT" ]; then
  echo "UNKNOWN"
  exit 1
fi

# GarminDevice.xml lives at different paths on different models/firmware
XML=""
for candidate in \
  "$MOUNT/GARMIN/GarminDevice.xml" \
  "$MOUNT/Garmin/GarminDevice.xml" \
  "$MOUNT/GarminDevice.xml"; do
  if [ -f "$candidate" ]; then
    XML="$candidate"
    break
  fi
done

if [ -z "$XML" ]; then
  # Mass storage XML not found — try MTP detection via mtp-detect
  if command -v mtp-detect &>/dev/null; then
    # Output format: "Device N (VID=... and PID=...) is a Garmin <model>."
    MTPDESC=$(mtp-detect 2>/dev/null \
      | grep -oi "is a Garmin [^.]*" \
      | head -1 \
      | sed 's/is a Garmin //')
    if [ -n "$MTPDESC" ]; then
      DESC="$MTPDESC"
    else
      echo "UNKNOWN"
      exit 1
    fi
  else
    echo "UNKNOWN"
    exit 1
  fi
fi

# Extract the human-readable description, strip XML tags and trademark symbols
DESC=$(grep -o '<Description>[^<]*</Description>' "$XML" 2>/dev/null \
  | head -1 \
  | sed 's/<[^>]*>//g; s/[®™°]//g; s/  */ /g; s/^ //; s/ $//')

if [ -z "$DESC" ]; then
  echo "UNKNOWN"
  exit 1
fi

# Map description string → CIQ device ID.
# Descriptions from GarminDevice.xml match the SDK compiler.json displayName
# (minus trademark symbols). Case-insensitive glob matching.
shopt -s nocasematch
case "$DESC" in
  *"Forerunner 965"*)                         echo "fr965"           ; exit 0 ;;
  *"Forerunner 645 Music"*)                   echo "fr645m"          ; exit 0 ;;
  *"Forerunner 645"*)                         echo "fr645"           ; exit 0 ;;
  *"Forerunner 265s"*)                        echo "fr265s"          ; exit 0 ;;
  *"Forerunner 265"*)                         echo "fr265"           ; exit 0 ;;
  *"Forerunner 255s Music"*)                  echo "fr255sm"         ; exit 0 ;;
  *"Forerunner 255 Music"*)                   echo "fr255m"          ; exit 0 ;;
  *"Forerunner 255s"*)                        echo "fr255s"          ; exit 0 ;;
  *"Forerunner 255"*)                         echo "fr255"           ; exit 0 ;;
  *"Forerunner 955"*)                         echo "fr955"           ; exit 0 ;;
  *"fenix 8"*"Solar"*"51"*)                   echo "fenix8solar51mm" ; exit 0 ;;
  *"fenix 8"*"Solar"*"47"*)                   echo "fenix8solar47mm" ; exit 0 ;;
  *"fenix 8"*"51"*|*"fenix 8"*"47"*)         echo "fenix847mm"      ; exit 0 ;;
  *"fenix 8"*"43"*)                           echo "fenix843mm"      ; exit 0 ;;
  *"fenix 7X"*)                               echo "fenix7x"         ; exit 0 ;;
  *"fenix 7S"*)                               echo "fenix7s"         ; exit 0 ;;
  *"fenix 7"*)                                echo "fenix7"          ; exit 0 ;;
  *"epix"*"Gen 2"*|*"epix"*"(Gen 2)"*)       echo "epix2"           ; exit 0 ;;
  *"Venu 3S"*)                                echo "venu3s"          ; exit 0 ;;
  *"Venu 3"*)                                 echo "venu3"           ; exit 0 ;;
  *)
    echo "UNKNOWN:$DESC"
    exit 1
    ;;
esac
