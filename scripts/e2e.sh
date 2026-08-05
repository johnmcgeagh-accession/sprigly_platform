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
# Derived from scripts/test-db.identity, never inlined: the seed now REFUSES any database that
# is not exactly that container, so a literal here that drifts from the guard's copy would
# break the harness — or, worse, agree with a guard that had drifted the other way.
export DATABASE_URL="$("$ROOT/scripts/test-db.sh" url)"
export PLAN_TODAY="2026-07-08"

MODE="${1:-full}"; shift || true

up()       { "$ROOT/scripts/test-db.sh" up; }
seed()     { pnpm --filter @sprigly/db build >/dev/null; pnpm --filter @sprigly/db exec tsx src/seed-e2e.ts; }
run()      { pnpm --filter @sprigly/app exec playwright test "$@"; }
run_prod() { pnpm --filter @sprigly/app exec playwright test --config=playwright.prod.config.ts "$@"; }
teardown() { "$ROOT/scripts/test-db.sh" destroy; }

case "$MODE" in
  full)
    up; seed
    set +e; run "$@"; code=$?; set -e
    teardown
    exit "$code"
    ;;
  prod)                     # prod-mode smoke (next build && next start, fakes off)
    up; seed
    set +e; run_prod "$@"; code=$?; set -e
    teardown
    exit "$code"
    ;;
  no-teardown) up; seed; run "$@" ;;
  seed)        seed ;;
  test)        run "$@" ;;
  test:prod)   run_prod "$@" ;;   # reuse a running container + prod app
  *) echo "usage: e2e.sh [full|prod|no-teardown|seed|test|test:prod] [playwright args]"; exit 1 ;;
esac
