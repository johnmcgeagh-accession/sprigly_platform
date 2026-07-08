#!/usr/bin/env bash
#
# dev-local.sh — one-command interactive LOCAL workspace (pnpm dev:local).
#
# Runs the app against the disposable pg17 test container (NOT the shared dev Railway
# DB) with the e2e fakes on, and prints clickable magic-link URLs for tenants A and B
# on both localhost and the machine's LAN IP (for phone testing).
#
# IMPORTANT: this deliberately starts `next dev` DIRECTLY, NOT via `pnpm --filter
# @sprigly/app dev` — that npm script does `set -a && . ../.env.local`, which re-exports
# DATABASE_URL and clobbers our container URL, pointing the app at the Railway dev DB
# (where the seeded tokens don't exist → "This link has expired"). Running next dev
# directly keeps our exported DATABASE_URL, which Next won't override.
#
#   pnpm dev:local            # container up (if needed) → reseed → start app → print URLs
#   pnpm dev:local --reseed   # reseed a running workspace + reprint URLs (app keeps running)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3200}"
TOKEN_A="e2e0000000000000000000000000000000000000000"
TOKEN_B="e2e1000000000000000000000000000000000000000"

ensure_container() {
  if docker ps --format '{{.Names}}' | grep -qx sprigly-testdb; then return 0; fi
  echo "dev:local: test container not running — creating it…"
  "$ROOT/scripts/test-db.sh" up
}
reseed() {
  export DATABASE_URL; pnpm --filter @sprigly/db build >/dev/null
  pnpm --filter @sprigly/db exec tsx src/seed-e2e.ts
}
lan_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(route get default 2>/dev/null | awk '/interface:/{print $2}' | xargs -I{} ipconfig getifaddr {} 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  echo "$ip"
}
print_urls() {
  cat <<EOF

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Sprigly plan redesign — local workspace (container DB, fakes on)          │
  └──────────────────────────────────────────────────────────────────────────┘

  Open on THIS Mac and (if a LAN IP) your PHONE — the same URL works from both:

  Tenant A · Ivy T (full plan)
    http://${HOST}:${PORT}/p/${TOKEN_A}
  Tenant B · Beta Co (empty cycle)
    http://${HOST}:${PORT}/p/${TOKEN_B}
$([ "$HOST" = "localhost" ] && echo "
  (No LAN IP detected — bound to localhost, so phone testing isn't available now.)")
  Tokens are long-lived (2035) and exist only in the local container.
  Reset data anytime (app keeps running):  pnpm dev:local --reseed

EOF
}

# Container URL drives DATABASE_URL. Ensure the container exists first so `url` is valid.
ensure_container
export DATABASE_URL="$("$ROOT/scripts/test-db.sh" url)"
export SPRIGLY_E2E_FAKE=1
export PLAN_TODAY="2026-07-08"
export REDIS_URL=""

# Bind to the LAN IP so a phone can reach it AND the /p/<token> redirect lands on the
# same host (Next dev pins the magic-link redirect to the BOUND host, not the Host
# header — so `-H 0.0.0.0` would redirect to 0.0.0.0 and break the cookie; binding the
# LAN IP makes one URL that works from both the Mac and the phone). Falls back to
# localhost with no network. The /p route is unchanged — this is purely a bind choice.
IP="$(lan_ip)"
if [ -n "$IP" ]; then HOST="$IP"; else HOST="localhost"; fi

if [ "${1:-}" = "--reseed" ]; then
  reseed
  print_urls
  echo "dev:local: reseeded. The running app now serves fresh data."
  exit 0
fi

reseed
print_urls
echo "dev:local: starting the app on http://${HOST}:${PORT} (Ctrl-C to stop)…"
cd "$ROOT/app"
# `next dev` directly (NOT the pnpm dev script) so our exported DATABASE_URL is preserved.
exec pnpm exec next dev --port "$PORT" -H "$HOST"
