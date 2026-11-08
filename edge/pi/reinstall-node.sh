#!/usr/bin/env bash
set -euo pipefail
systemctl stop replay-agent || true
ARCH=arm64
BASE=https://nodejs.org/dist/latest-v22.x
FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep "linux-${ARCH}.tar.xz$")"
TMP="$(mktemp -d)"
curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
(cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | sha256sum -c -)
rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx
tar -xJf "$TMP/$FILE" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
rm -rf "$TMP"
/usr/local/bin/node -v
systemctl reset-failed replay-agent || true
systemctl start replay-agent
sleep 5
systemctl is-active replay-agent
curl -s 127.0.0.1:8788/health || true
echo
