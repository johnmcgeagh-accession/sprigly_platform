FROM node:22-slim

# ── Python runtime for content-calendar scripts ──────────────────────────────
# Isolated in /opt/cal-venv so pip packages never collide with system packages.
# Worker invokes scripts via: /opt/cal-venv/bin/python3 /app/apps/worker/scripts/calendar/<script>.py
# Only openpyxl is required — neither generate_calendar.py nor extract_edits.py uses pandas.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
    && python3 -m venv /opt/cal-venv \
    && /opt/cal-venv/bin/pip install --no-cache-dir openpyxl==3.1.5 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Install pnpm via corepack (bundled with Node) ────────────────────────────
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy everything (the .dockerignore controls what's actually copied)
COPY . .

# Install deps and build the worker (and all its workspace dependencies)
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sprigly/worker... build
RUN chmod +x /app/docker-entrypoint.sh

# Migrate then start — entrypoint runs migrations before handing off to the worker.
# DATABASE_URL must be present at container start (Railway injects it automatically).
CMD ["/app/docker-entrypoint.sh"]
