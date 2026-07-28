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
#   ./scripts/test-db.sh up          # LOCAL: container + cached baseline + apply the list
#   ./scripts/test-db.sh manifest    # check every migration is named in NEW or SKIP
#   ./scripts/test-db.sh verify      # apply the list TWICE — the second pass must be a no-op
#   ./scripts/test-db.sh ledger      # what this database has actually had applied
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

# ── The apply list ────────────────────────────────────────────────────────────────────
#
# EVERY migration from FLOOR to current, in order, by EXACT filename. Never a glob: a glob
# over *.sql sweeps in the .down.sql files and tears the schema down mid-run (the 0089
# incident). migrate:down reverses this list.
#
# WHY A FLOOR AND NOT "ALL". Migrations below FLOOR are not replayable — they include
# drizzle-generated DDL against a schema that no longer exists and seeds that assume rows
# long gone. The baseline dump carries that ancient history; this list carries everything
# since, so the test schema is a function of the migration FILES rather than of the day the
# snapshot happened to be pulled.
#
# EACH FILE RUNS EXACTLY ONCE, tracked in a ledger table (see ledger_* below). That is the
# cure for the disease, not just this instance of it: the old `up` had no record of what it
# had applied, so it depended on the cached snapshot being newer than a hand-maintained
# ceiling — which is exactly how the stop-at-0073 defect stayed invisible for thirteen
# migrations. 0074–0087 worked by accident of the pull date; only 0088+ failed, and only at
# seed time. With a ledger, the next hand-applied migration is picked up on the next `up`
# without anyone remembering, and a migration missing from this list is refused loudly.
#
# A ledger also removes any need for these files to be re-runnable. Most are (IF NOT EXISTS
# / WHERE NOT EXISTS), but 0077_email_templates inserts unguarded and fails on a second
# application — `verify` found that, and with a ledger it does not matter.
FLOOR="0066"
NEW=(
  0066_post_steps
  0067_step_templates
  0068_plan_activity
  0069_ui_events
  0070_hooks_scripts
  0071_generation_prompts
  0072_ivy_t_generation_prompts
  0073_refine_prompts
  0074_ig_posts
  0076_intake_capture_send_log
  0077_email_templates
  0078_ask_template_v2
  0079_themes
  0080_beat_skip_reasons
  0084_draft_beat_meta
  0085_ask_drafted_template
  0086_plan_inputs_backlog
  0087_draft_approval
  0088_plan_ready_auto
  0089_plan_ready_sent
  0090_actor_attribution
)

# Deliberately NOT applied, each for a stated reason. A migration is either in NEW or in
# here — `manifest_check` refuses to run if the directory holds one that is in neither, so
# the NEXT hand-applied migration is LOUDLY MISSING rather than silently skipped. That is
# the actual defect being fixed: a stale ceiling is a symptom, a silent ceiling is the bug.
SKIP=(
  # Prod catch-up files. They bring PROD's structure and seed data up to UAT, and this
  # database is baselined FROM uat — applying them here replays uat into uat.
  0081_uat_to_prod_delta
  0082_prod_data_seed
  0082_reference_and_prompt_seed

  # CLIENT-DATA MIGRATIONS. Both edit ivy-t's own prompt rows, and the baseline is
  # SCHEMA-ONLY — it carries no clients and therefore none of the per-client prompt rows
  # 0072 would have seeded. 0075 derives its version from max(version) over rows that do not
  # exist (NULL + 1 → NOT NULL violation); 0083 checks for the two ivy-t v1 rows up front and
  # aborts with its own precondition message. Both are idempotent against a POPULATED
  # database and inapplicable to an empty one — which is a property of the baseline, not a
  # defect in them. The e2e suite seeds the prompt rows its tests need
  # (packages/db/src/seed-e2e.ts).
  0075_generate_plan_deivyt
  0083_ivy_hook_script_prompt_v2
)

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

# ── The drift guard ──────────────────────────────────────────────────────────────────
#
# Every numbered migration at or above FLOOR must be named in NEW or in SKIP. Nothing else
# is allowed to exist quietly.
#
# This is the actual fix. The old list stopped at 0073 and said nothing about it, so a
# migration hand-applied to uat and never added here simply never reached the test database
# — and because the cached baseline happened to be newer than 0073, the gap only surfaced
# thirteen migrations later, as seed-e2e dying on plan_ready_sent_at. The same dead-ledger
# shape as the prod audits: two stale artefacts whose staleness cancels in the middle and
# shows only at the edges.
#
# .down.sql files are excluded by suffix, never by relying on a glob to miss them.
manifest_check() {
  local f base missing=()
  for f in "${MIGRATIONS}"/[0-9][0-9][0-9][0-9]_*.sql; do
    base="$(basename "$f" .sql)"
    case "$base" in *.down) continue ;; esac        # .down.sql — never applied forward
    [[ "${base:0:4}" < "$FLOOR" ]] && continue      # below the floor — the baseline carries it
    if ! printf '%s\n' "${NEW[@]}" "${SKIP[@]}" | grep -qxF "$base"; then missing+=("$base"); fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    {
      echo "test-db: MIGRATION MANIFEST IS OUT OF DATE."
      echo
      echo "  These exist in packages/db/migrations and are in neither NEW nor SKIP:"
      printf '    %s\n' "${missing[@]}"
      echo
      echo "  Add each to NEW (to apply it) or to SKIP (with a reason) in scripts/test-db.sh."
      echo "  Refusing to build a database that silently lacks them — that is the bug this"
      echo "  check exists to prevent, not a nuisance it introduces."
    } >&2
    exit 1
  fi
}

# ── The ledger ───────────────────────────────────────────────────────────────────────
#
# What this database has actually had applied to it. The repo's real ledger
# (__drizzle_migrations) froze at 0026 and every migration since is hand-applied, so there
# is no record anywhere of what a given database carries — which is the shared root of this
# bug and of the prod audits. This table is that record for the test database, and it is the
# only reason `up` can be run twice, or run a week later after two new migrations landed,
# and do the right thing both times.
#
# It deliberately does NOT claim to know what the baseline dump contains. A fresh baseline
# starts the ledger empty and every file in NEW is applied over it; that is safe because the
# dump is schema-only (no rows) and the DDL is guarded.
LEDGER="_test_db_migrations"

ledger_init() {
  psql_run -q -c "CREATE TABLE IF NOT EXISTS ${LEDGER} (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
}
ledger_has()    { psql_run -tAc "SELECT 1 FROM ${LEDGER} WHERE filename = '$1'" | grep -qx 1; }
ledger_add()    { psql_run -q -c "INSERT INTO ${LEDGER} (filename) VALUES ('$1') ON CONFLICT DO NOTHING;"; }
ledger_remove() { psql_run -q -c "DELETE FROM ${LEDGER} WHERE filename = '$1';"; }

apply_up() {
  manifest_check
  ledger_init
  local m applied=0 skipped=0
  for m in "${NEW[@]}"; do
    if ledger_has "$m"; then skipped=$((skipped + 1)); continue; fi
    echo "test-db: apply ${m}.sql"
    psql_run -f "${MIGRATIONS}/${m}.sql"
    ledger_add "$m"
    applied=$((applied + 1))
  done
  echo "test-db: ${applied} applied, ${skipped} already in the ledger"
}
# Reverse order, and only for the files that HAVE a .down — several of the seed-only
# migrations never shipped one, and a missing file must say so rather than abort the run.
apply_down() {
  manifest_check
  ledger_init
  local m
  for ((i=${#NEW[@]}-1; i>=0; i--)); do
    m="${NEW[$i]}"
    if [ -f "${MIGRATIONS}/${m}.down.sql" ]; then
      echo "test-db: apply ${m}.down.sql"; psql_run -f "${MIGRATIONS}/${m}.down.sql"; ledger_remove "$m"
    else
      echo "test-db: ${m} has no .down.sql — skipped (forward-only)"
    fi
  done
}

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
    # Load the baseline only if the database is empty; then ALWAYS apply the list.
    #
    # The old version had a second probe here — skip apply_up when `hook_patterns` exists —
    # which made the apply list conditional on a table that a fresh-enough baseline already
    # carries. A newer snapshot therefore DISABLED the migrations meant to run on top of it,
    # silently. Every file in NEW is idempotent, so running it unconditionally costs a second
    # and removes the whole class.
    if ! table_exists clients; then
      echo "test-db: loading cached schema baseline (no remote connection)…"
      psql_run -f "$DUMP" >/dev/null
    else
      echo "test-db: baseline already present"
    fi
    apply_up
    echo "test-db: ready at ${URL} (baseline + ${#NEW[@]} migrations)"
    ;;
  verify)
    # Run the list twice. The second pass must apply NOTHING — that is the ledger working.
    # Before the ledger this was a real risk: 0077_email_templates inserts unguarded and
    # fails on a second application, which is how this check earned its place.
    start_container; apply_up; echo "test-db: --- second pass (should apply nothing) ---"; apply_up
    ;;
  ledger)
    ledger_init
    psql_run -c "SELECT filename, applied_at FROM ${LEDGER} ORDER BY filename;"
    ;;
  manifest)     manifest_check; echo "test-db: manifest OK — ${#NEW[@]} applied, ${#SKIP[@]} skipped, floor ${FLOOR}" ;;
  refresh)      refresh_baseline ;;
  migrate:up)   apply_up ;;
  migrate:down) apply_down ;;
  url)          echo "$URL" ;;
  psql)         PGPASSWORD="$PGPASS" psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$DBNAME" ;;
  destroy)      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; echo "test-db: container removed (schema baseline kept — use 'destroy:all' to purge)" ;;
  destroy:all)  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -f "$DUMP"; echo "test-db: destroyed (container + baseline)" ;;
  *) sed -n '2,25p' "${BASH_SOURCE[0]}" ;;
esac
