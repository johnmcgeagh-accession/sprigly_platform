#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
pnpm --filter @sprigly/db migrate:prod
echo "[entrypoint] Migrations complete. Starting worker..."
exec pnpm --filter @sprigly/worker start
