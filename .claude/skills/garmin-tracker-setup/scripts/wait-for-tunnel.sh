#!/usr/bin/env bash
# Polls the daemon config until a tunnel URL appears, or times out.
# Prints the URL on success. Exits 1 on timeout.

CONFIG="$HOME/.config/claude-code-tracker/config.json"
TIMEOUT=${1:-45}

for i in $(seq 1 "$TIMEOUT"); do
  URL=$(python3 -c "
import json, sys
try:
  d = json.load(open('$CONFIG'))
  u = d.get('tunnel', {}).get('last_known_url') or ''
  print(u)
except Exception as e:
  print('')
" 2>/dev/null)

  if [ -n "$URL" ] && [ "$URL" != "null" ] && [ "$URL" != "None" ]; then
    echo "$URL"
    exit 0
  fi

  sleep 1
done

echo "TIMEOUT"
exit 1
