#!/usr/bin/env bash
# Prints the detected OS and exits 1 if unsupported.
set -e

case "$(uname -s)" in
  Darwin) echo "macos" ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "wsl2"
    else
      echo "linux"
    fi
    ;;
  MINGW*|CYGWIN*|MSYS*)
    echo "windows-native"
    exit 1
    ;;
  *)
    echo "unknown"
    exit 1
    ;;
esac
