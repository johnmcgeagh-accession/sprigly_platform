FROM node:22-slim

# Install pnpm via corepack (bundled with Node)
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
