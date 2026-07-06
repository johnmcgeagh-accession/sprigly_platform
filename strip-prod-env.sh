#!/usr/bin/env bash
# strip-prod-env.sh — remove commented-out env var lines from .env.local
set -euo pipefail

SRC="${1:-.env.local}"
PATTERN='^[[:space:]]*#+[[:space:]]*[A-Za-z_][A-Za-z0-9_]*='

[[ -f "$SRC" ]] || { echo "File not found: $SRC" >&2; exit 1; }

echo "Lines that will be REMOVED from $SRC:"
echo "----------------------------------------"
grep -E "$PATTERN" "$SRC" || { echo "(none found — nothing to do)"; exit 0; }
echo "----------------------------------------"
read -r -p "Delete these lines? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "Aborted, nothing changed."; exit 0; }

cp "$SRC" "$SRC.bak"
grep -vE "$PATTERN" "$SRC" > "$SRC.tmp" && mv "$SRC.tmp" "$SRC"

echo "Done. Original backed up at $SRC.bak — delete it once you've confirmed."
