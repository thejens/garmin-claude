#!/usr/bin/env bash
# Generates the Connect IQ developer signing key if it doesn't already exist.
set -e

KEY="watch/developer_key"

if [ -f "$KEY" ]; then
  echo "exists: $KEY"
  exit 0
fi

openssl genrsa -out /tmp/_ciq_dev_tmp.pem 4096 2>/dev/null
openssl pkcs8 -topk8 -inform PEM -outform DER \
  -in /tmp/_ciq_dev_tmp.pem -out "$KEY" -nocrypt
rm -f /tmp/_ciq_dev_tmp.pem

echo "created: $KEY"
