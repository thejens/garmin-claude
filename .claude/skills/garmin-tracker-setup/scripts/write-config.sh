#!/usr/bin/env bash
# Writes watch/source/Config.mc from the template, and narrows manifest.xml to
# target only the user's device (a personal sideloaded build needs no others).
#
# Usage: write-config.sh <DAEMON_URL> <BEARER_KEY> <DEVICE> [POLL_MS] [INCLUDE_PHYSIOLOGY]
set -e

DAEMON_URL="${1:?DAEMON_URL required}"
BEARER_KEY="${2:?BEARER_KEY required}"
DEVICE="${3:?DEVICE required (e.g. fr965)}"
POLL_MS="${4:-2000}"
INCLUDE_PHYSIOLOGY="${5:-true}"

TEMPLATE=".claude/skills/garmin-tracker-setup/templates/Config.mc.template"
CONFIG_OUT="watch/source/Config.mc"
MANIFEST="watch/manifest.xml"

# ── Config.mc ─────────────────────────────────────────────────────────────────
if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: template not found at $TEMPLATE" >&2
  exit 1
fi

sed \
  -e "s|%%DAEMON_URL%%|$DAEMON_URL|g" \
  -e "s|%%BEARER_KEY%%|$BEARER_KEY|g" \
  -e "s|%%POLL_INTERVAL_MS%%|$POLL_MS|g" \
  -e "s|%%INCLUDE_PHYSIOLOGY%%|$INCLUDE_PHYSIOLOGY|g" \
  "$TEMPLATE" > "$CONFIG_OUT"

echo "Wrote $CONFIG_OUT"

# ── manifest.xml — narrow product list to the single target device ─────────────
# The repo manifest lists all supported devices for reference; a personal build
# only needs the user's own watch. We replace the <iq:products> block in-place.
python3 - "$MANIFEST" "$DEVICE" << 'PYEOF'
import re, sys

manifest_path = sys.argv[1]
device        = sys.argv[2]

text = open(manifest_path).read()

new_products = (
    "        <iq:products>\n"
    f"            <iq:product id=\"{device}\"/>\n"
    "        </iq:products>"
)

updated = re.sub(
    r'        <iq:products>.*?</iq:products>',
    new_products,
    text,
    flags=re.DOTALL,
)

if updated == text:
    print(f"Warning: could not find <iq:products> block in {manifest_path}", file=sys.stderr)
    sys.exit(1)

open(manifest_path, 'w').write(updated)
print(f"Narrowed manifest.xml to <iq:product id=\"{device}\"/>")
PYEOF
