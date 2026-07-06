#!/usr/bin/env bash
# extract-prod-env.sh — pull commented-out env vars from .env.local into .env.prod
set -euo pipefail

SRC="${1:-.env.local}"
OUT="${2:-.env.prod}"

if [[ ! -f "$SRC" ]]; then
  echo "Source file not found: $SRC" >&2
  exit 1
fi

if [[ -e "$OUT" ]]; then
  echo "Refusing to overwrite existing $OUT — move or delete it first." >&2
  exit 1
fi

# Match lines that are: optional whitespace, one or more #, optional whitespace,
# then KEY=... where KEY is a valid env var name. Strip the leading #s.
grep -E '^[[:space:]]*#+[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$SRC" \
  | sed -E 's/^[[:space:]]*#+[[:space:]]*//' > "$OUT"

chmod 600 "$OUT"

echo "Extracted $(wc -l < "$OUT" | tr -d ' ') variable(s) from $SRC → $OUT (mode 600)"
