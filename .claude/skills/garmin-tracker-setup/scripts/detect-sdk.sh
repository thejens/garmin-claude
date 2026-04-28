#!/usr/bin/env bash
# Finds the Connect IQ SDK and prints the monkeyc path.
# Exits 1 if not found.

# Try PATH first
if command -v monkeyc &>/dev/null; then
  echo "$(command -v monkeyc)"
  exit 0
fi

# macOS standard install location
SDK_BIN=$(ls -d "$HOME/Library/Application Support/Garmin/ConnectIQ/Sdks"/connectiq-sdk-mac-*/bin 2>/dev/null | sort -V | tail -1)
if [ -n "$SDK_BIN" ] && [ -f "$SDK_BIN/monkeyc" ]; then
  echo "$SDK_BIN/monkeyc"
  echo "SDK found at: $SDK_BIN" >&2
  echo "Add to PATH:  export PATH=\"\$PATH:$SDK_BIN\"" >&2
  exit 0
fi

# Linux standard location
SDK_BIN=$(ls -d "$HOME/Library/ConnectIQ/Sdks"/connectiq-sdk-linux-*/bin 2>/dev/null | sort -V | tail -1)
if [ -n "$SDK_BIN" ] && [ -f "$SDK_BIN/monkeyc" ]; then
  echo "$SDK_BIN/monkeyc"
  exit 0
fi

echo "NOT_FOUND"
exit 1
