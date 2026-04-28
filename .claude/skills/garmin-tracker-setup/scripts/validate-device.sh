#!/usr/bin/env bash
# Verify that a CIQ device ID is declared in watch/manifest.xml.
# Prints "OK" on success, "UNSUPPORTED" and lists valid devices on failure.
# Usage: validate-device.sh <device-id>

DEVICE="${1:?device ID required}"
MANIFEST="watch/manifest.xml"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found" >&2
  exit 2
fi

if grep -q "id=\"${DEVICE}\"" "$MANIFEST"; then
  echo "OK"
  exit 0
fi

# Print the supported device list for the error message
# Device IDs are short lowercase alphanumeric (e.g. fr965, fenix7x).
# Exclude the 32-char app UUID, permission names, and language codes.
SUPPORTED=$(grep -oE 'id="[a-z][a-z0-9]+"' "$MANIFEST" \
  | sed 's/id="//; s/"//' \
  | grep -vE '^(eng|[0-9a-f]{20,})$' \
  | tr '\n' ' ')

echo "UNSUPPORTED"
echo "  '$DEVICE' is not in manifest.xml." >&2
echo "  Supported: $SUPPORTED" >&2
exit 1
