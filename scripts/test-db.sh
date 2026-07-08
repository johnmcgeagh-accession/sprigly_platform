#!/usr/bin/env bash
#
# test-db.sh — a DISPOSABLE, LOCAL Postgres for verifying migrations (up→down→up) and
# running the plan_activity integration test. It is baselined from a SCHEMA-ONLY dump
# of the dev DB (read-only pg_dump — no prod data ever reaches git or a shared write),
# then the new redesign migrations are applied on top.
#
# It must NEVER be pointed at a shared DB. The dump is written to .test-db/ (gitignored)
# and refreshed on each `up`. Uses the pgvector image because the schema has vector
# columns (knowledge_chunks.embedding). See design/DECISIONS.md.
#
#   ./scripts/test-db.sh up          # container + fresh schema dump + apply 0066–0068 up
#   ./scripts/test-db.sh migrate:down# apply the .down.sql for 0068,0067,0066 (reverse)
#   ./scripts/test-db.sh migrate:up  # apply 0066,0067,0068 up
#   ./scripts/test-db.sh url         # print the container connection string
#   ./scripts/test-db.sh psql        # open psql on the container
#   ./scripts/test-db.sh destroy     # remove the container and the dump
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
NEW=(0066_post_steps 0067_step_templates 0068_plan_activity 0069_ui_events 0070_hooks_scripts 0071_generation_prompts)

psql_run() { PGPASSWORD="$PGPASS" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -p "$PORT" -U postgres -d "$DBNAME" "$@"; }

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

dump_dev_schema() {
  [ -f "$DEV_ENV" ] || { echo "test-db: no ${DEV_ENV}" >&2; exit 1; }
  local dev_url
  dev_url="$(grep -E '^DATABASE_URL=' "$DEV_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$dev_url" ] || { echo "test-db: no DATABASE_URL in ${DEV_ENV}" >&2; exit 1; }
  mkdir -p "$(dirname "$DUMP")"
  echo "test-db: dumping dev schema (schema-only, no data)…"
  pg_dump --schema-only --no-owner --no-privileges "$dev_url" > "$DUMP"
}

apply_up()   { for m in "${NEW[@]}"; do echo "test-db: apply ${m}.sql";      psql_run -f "${MIGRATIONS}/${m}.sql"; done; }
apply_down() { for ((i=${#NEW[@]}-1; i>=0; i--)); do echo "test-db: apply ${NEW[$i]}.down.sql"; psql_run -f "${MIGRATIONS}/${NEW[$i]}.down.sql"; done; }

case "${1:-help}" in
  up)
    start_container
    dump_dev_schema
    echo "test-db: loading dev schema baseline…"
    psql_run -f "$DUMP" >/dev/null
    apply_up
    echo "test-db: ready at ${URL}"
    ;;
  migrate:up)   apply_up ;;
  migrate:down) apply_down ;;
  url)          echo "$URL" ;;
  psql)         PGPASSWORD="$PGPASS" psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$DBNAME" ;;
  destroy)      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -f "$DUMP"; echo "test-db: destroyed" ;;
  *) sed -n '2,25p' "${BASH_SOURCE[0]}" ;;
esac
