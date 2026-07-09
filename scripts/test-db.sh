#!/usr/bin/env bash
#
# test-db.sh — a DISPOSABLE, LOCAL Postgres for the local workspace (dev:local), for
# verifying migrations (up→down→up), and for the integration tests. It is baselined from
# a SCHEMA-ONLY dump of the remote DB's STRUCTURE (read-only pg_dump — no row data ever
# read or committed), then the redesign migrations are applied on top.
#
# `up` is LOCAL-ONLY: it never connects to the remote — it reuses a cached baseline at
# .test-db/schema.sql (gitignored). The ONLY command that touches the remote is
# `refresh`, and it is explicit/opt-in — run it once (while the remote is reachable) to
# create the baseline; after that everything is offline. Uses the pgvector image because
# the schema has vector columns (knowledge_chunks.embedding). See design/DECISIONS.md.
#
#   ./scripts/test-db.sh up          # LOCAL: container + cached baseline + apply 0066+ up
#   ./scripts/test-db.sh refresh     # ONE-TIME remote step: pull the schema baseline
#   ./scripts/test-db.sh migrate:down# apply the .down.sql (reverse order)
#   ./scripts/test-db.sh migrate:up  # apply 0066+ up
#   ./scripts/test-db.sh url         # print the container connection string
#   ./scripts/test-db.sh psql        # open psql on the container
#   ./scripts/test-db.sh destroy     # remove the container (keeps the baseline)
#   ./scripts/test-db.sh destroy:all # remove the container AND the baseline
#
set -euo pipefail

CONTAINER="sprigly-testdb"
IMAGE="pgvector/pgvector:pg17"
PORT="55432"
PGPASS="postgres"
DBNAME="sprigly_test"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${ROOT}/.test-db/schema.sql"
MIGRATIONS="${ROOT}/packages/db/migrations"
DEV_ENV="${ROOT}/.env.local"
URL="postgresql://postgres:${PGPASS}@127.0.0.1:${PORT}/${DBNAME}"

# Applied on top of the dev baseline, in order. migrate:down reverses this list.
NEW=(0066_post_steps 0067_step_templates 0068_plan_activity 0069_ui_events 0070_hooks_scripts 0071_generation_prompts 0072_ivy_t_generation_prompts)

psql_run() { PGPASSWORD="$PGPASS" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DBNAME" "$@"; }

# True if a public table exists (used to make `up` idempotent / self-healing).
table_exists() { psql_run -tAc "SELECT to_regclass('public.$1') IS NOT NULL" 2>/dev/null | grep -qx t; }

wait_ready() {
  for _ in $(seq 1 30); do
    if docker exec "$CONTAINER" pg_isready -U postgres -d "$DBNAME" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "test-db: postgres did not become ready" >&2; return 1
}

start_container() {
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then return 0; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker start "$CONTAINER" >/dev/null
  else
    docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$DBNAME" \
      -p "${PORT}:5432" "$IMAGE" >/dev/null
  fi
  wait_ready
}

have_baseline() { [ -s "$DUMP" ]; }   # exists AND non-empty

# Refresh the LOCAL schema baseline from the dev DB. This is the ONLY command that
# connects to the remote — it is explicit + opt-in (`up` never calls it). Schema-only,
# read-only, atomic (a failed pull never clobbers a good baseline).
refresh_baseline() {
  [ -f "$DEV_ENV" ] || { echo "test-db: no ${DEV_ENV}" >&2; exit 1; }
  local dev_url tmp
  dev_url="$(grep -E '^DATABASE_URL=' "$DEV_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$dev_url" ] || { echo "test-db: no DATABASE_URL in ${DEV_ENV}" >&2; exit 1; }
  mkdir -p "$(dirname "$DUMP")"
  tmp="$(mktemp)"
  echo "test-db: refreshing schema baseline from ${dev_url%%\?*} (schema-only, no data)…"
  if pg_dump --schema-only --no-owner --no-privileges "$dev_url" > "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" "$DUMP"
    echo "test-db: baseline written to ${DUMP} ($(wc -l < "$DUMP") lines)"
  else
    rm -f "$tmp"
    echo "test-db: schema refresh FAILED (remote unreachable?) — existing baseline untouched" >&2
    exit 1
  fi
}

apply_up()   { for m in "${NEW[@]}"; do echo "test-db: apply ${m}.sql";      psql_run -f "${MIGRATIONS}/${m}.sql"; done; }
apply_down() { for ((i=${#NEW[@]}-1; i>=0; i--)); do echo "test-db: apply ${NEW[$i]}.down.sql"; psql_run -f "${MIGRATIONS}/${NEW[$i]}.down.sql"; done; }

case "${1:-help}" in
  up)
    # LOCAL ONLY — never connects to the remote. Reuses the cached schema baseline;
    # if there isn't one, it tells you to run `refresh` once (the only remote step).
    if ! have_baseline; then
      cat >&2 <<MSG
test-db: no local schema baseline at ${DUMP}.
  It is built ONCE from the UAT DB's structure (schema-only, no data). Run:
      ./scripts/test-db.sh refresh
  while the UAT DB is reachable, then re-run 'up'. After that, up/dev:local are
  fully offline and never touch the remote again.
MSG
      exit 1
    fi
    start_container
    # Idempotent + self-healing: load only what's missing, so a leftover empty container
    # (e.g. from an earlier failed run) gets its schema, and a ready one is left alone.
    if ! table_exists clients; then
      echo "test-db: loading cached schema baseline (no remote connection)…"
      psql_run -f "$DUMP" >/dev/null
      apply_up
    elif ! table_exists hook_patterns; then
      echo "test-db: baseline present — applying redesign migrations…"
      apply_up
    else
      echo "test-db: schema already present — nothing to load"
    fi
    echo "test-db: ready at ${URL}"
    ;;
  refresh)      refresh_baseline ;;
  migrate:up)   apply_up ;;
  migrate:down) apply_down ;;
  url)          echo "$URL" ;;
  psql)         PGPASSWORD="$PGPASS" psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$DBNAME" ;;
  destroy)      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; echo "test-db: container removed (schema baseline kept — use 'destroy:all' to purge)" ;;
  destroy:all)  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -f "$DUMP"; echo "test-db: destroyed (container + baseline)" ;;
  *) sed -n '2,25p' "${BASH_SOURCE[0]}" ;;
esac
