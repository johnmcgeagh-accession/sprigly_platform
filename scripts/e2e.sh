#!/usr/bin/env bash
#
# e2e.sh — one command for the plan-redesign Playwright suite.
#
#   pnpm e2e                 # full: container up + migrations → seed → run → teardown
#   bash scripts/e2e.sh no-teardown   # same, but leave container + app up
#   bash scripts/e2e.sh seed          # (re)apply the seed to a running container
#   bash scripts/e2e.sh test [args]   # reuse a running container + app; just run Playwright
#
# The app under test is `next dev` (NODE_ENV=development) so the hard-gated e2e fakes
# activate (see design/DECISIONS.md). Playwright's webServer starts/points at it; the
# container + seed are provisioned here first.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/sprigly_test"
export PLAN_TODAY="2026-07-08"

MODE="${1:-full}"; shift || true

up()       { "$ROOT/scripts/test-db.sh" up; }
seed()     { pnpm --filter @sprigly/db build >/dev/null; pnpm --filter @sprigly/db exec tsx src/seed-e2e.ts; }
run()      { pnpm --filter @sprigly/app exec playwright test "$@"; }
teardown() { "$ROOT/scripts/test-db.sh" destroy; }

case "$MODE" in
  full)
    up; seed
    set +e; run "$@"; code=$?; set -e
    teardown
    exit "$code"
    ;;
  no-teardown) up; seed; run "$@" ;;
  seed)        seed ;;
  test)        run "$@" ;;
  *) echo "usage: e2e.sh [full|no-teardown|seed|test] [playwright args]"; exit 1 ;;
esac
