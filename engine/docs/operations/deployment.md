# Deployment

## Infrastructure

Three services:

| Service | Platform | What it does |
|---|---|---|
| Worker | Railway | BullMQ consumer + Gmail poller. Node.js process. |
| PostgreSQL | Railway | Primary database. Managed by Railway. |
| Redis | Railway | BullMQ job queue. Managed by Railway. |
| Admin web app | Vercel | Next.js app. Read/write access to the database. |

The worker and admin web app are in the same Turborepo monorepo at `/Users/johnmcgeagh/Documents/Workspaces/sprigly/engine`. They share packages but deploy independently.

---

## Worker deployment

### Environment variables

The worker validates env vars at startup via Zod (`apps/worker/src/env.ts`). Missing or malformed vars cause an immediate fatal log and `process.exit(1)`. The process does not start.

Required vars:

```
DATABASE_URL
REDIS_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
TAVILY_API_KEY
MODEL_PROVIDER           # 'bedrock' in production
AWS_REGION               # eu-west-2
BEDROCK_AWS_ACCESS_KEY_ID
BEDROCK_AWS_SECRET_ACCESS_KEY
BEDROCK_MODEL_ID_HAIKU
BEDROCK_MODEL_ID_SONNET
BEDROCK_MODEL_ID_OPUS
AWS_KMS_KEY_ID
KMS_AWS_ACCESS_KEY_ID
KMS_AWS_SECRET_ACCESS_KEY
```

See `reference/env-vars.md` for the full list with descriptions.

**Critical:** Do not set `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` (the generic AWS env vars). The worker uses dedicated vars `BEDROCK_AWS_ACCESS_KEY_ID` and `KMS_AWS_ACCESS_KEY_ID` to keep the two IAM users separate. Setting the generic vars causes the AWS SDK to pick up whichever user it sees first, bypassing the intended separation. See `architecture/decisions.md` ADR 9.

### Startup sequence

`apps/worker/src/index.ts` runs this in order:

1. Validate env vars (`zod.parse(process.env)`). Fatal exit on failure.
2. Create model client (`createModelClientFromEnv()`). Fatal exit on Zod error.
3. Create audit logger, prompt resolver, encryption provider.
4. Register two workflows (`sprigly-blog-post`, `sprigly-prospect-research`).
5. Create `EventRouter`, `TavilyProvider`, `WorkflowRunner`.
6. Create `DestinationDispatcher`, register four destinations.
7. Create `GmailPoller`.
8. Create BullMQ queue (`incoming-events`).
9. Create BullMQ consumer (concurrency 10).
10. Run first poll cycle (`pollAllClients()`).
11. Start poll interval timer (`POLL_INTERVAL_MS`, default 60 seconds).
12. Register SIGTERM/SIGINT handlers for graceful shutdown.
13. Register `unhandledRejection` and `uncaughtException` handlers.

`unhandledRejection` and `uncaughtException` are logged but do not kill the process. This is intentional: a rejected promise from a void'd poll cycle should not take down the consumer.

### Graceful shutdown

On SIGTERM or SIGINT:
1. Clear the poll interval.
2. Close the BullMQ consumer (`await consumer.close()`).
3. Close the BullMQ queue (`await queue.close()`).
4. `process.exit(0)`.

Railway sends SIGTERM before a deploy. The worker finishes in-flight jobs before exiting.

### Running migrations before deploy

Migrations run via:

```bash
pnpm db:migrate
```

This runs `tsx src/migrate.ts` in `packages/db`, which calls `drizzle-orm/postgres-js/migrator` against `DATABASE_URL`. It prints `Migration complete` and exits cleanly on success.

Run this before deploying a worker version that requires new tables or schema changes. Migrations are forward-only -- there are no down migrations.

---

## Admin web app deployment

The admin app is a Next.js app deployed on Vercel (`apps/web`).

Required env vars for Vercel:

```
DATABASE_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
GOOGLE_CLIENT_ID           # for OAuth callback page
GOOGLE_CLIENT_SECRET       # for OAuth callback page
GOOGLE_OAUTH_REDIRECT_URI  # must match the Vercel deployment URL
SPRIGLY_CLIENT_ID          # UUID of the initial client row
ADMIN_USER_EMAIL           # Clerk user email allowed admin access
```

The admin app does not use Bedrock, Tavily, Redis, or KMS directly. It reads and writes the database via Drizzle and handles Google OAuth callbacks for onboarding Gmail connections.

---

## Onboarding a new client

A new client needs:
1. A row in `clients` and `client_configs`.
2. A Gmail OAuth connection.
3. At least one routing rule.
4. Prompt templates (global defaults exist; client-specific overrides are optional).

**Step 1:** Create client and config rows. This can be done via the admin UI (`/admin/clients`) or via a seed migration.

**Step 2:** Connect Gmail. Run the OAuth setup script against the running worker environment:

```bash
tsx apps/worker/src/setup-gmail-oauth.ts <client-slug>
```

This opens a browser-based OAuth flow, captures the authorization code on a local server at `http://localhost:3456`, exchanges it for tokens, and stores the encrypted token bundle in `oauth_connections`. The worker's poller picks up the new connection on the next poll cycle.

Scopes granted: `gmail.readonly`, `gmail.modify`, `gmail.send`.

**Step 3:** Create routing rules via the admin UI (`/admin/routing-rules/new`). At minimum, one rule per workflow you want to run for this client.

**Step 4:** If the client needs custom prompt text, create client-specific overrides via the admin UI (`/admin/prompts`). Global defaults work for all clients without this step.

---

## Updating model IDs

Bedrock cross-region inference profile IDs are set by env var (`BEDROCK_MODEL_ID_HAIKU`, `BEDROCK_MODEL_ID_SONNET`, `BEDROCK_MODEL_ID_OPUS`). To update to a new model version:

1. Find the new profile ID in AWS Console under Amazon Bedrock → Model access → Cross-region inference.
2. Update the env var in Railway.
3. Redeploy the worker.

No code change is needed.

---

## Gotchas

**Migrations are not run automatically on deploy.** Railway deploys the worker by pulling the image and starting it. The Drizzle migrator is a separate step -- it does not run as part of `index.ts`. You must run `pnpm db:migrate` manually (or as a pre-deploy step in your CI pipeline) before deploying schema-changing code.

**The worker does not wait for the database to be ready.** If the database is starting up when the worker launches, the first `db.select()` call may fail. Railway typically starts services in dependency order, but there is no built-in wait. If this occurs, the poller logs an error and continues on the next interval.

**POLL_INTERVAL_MS defaults to 60 seconds.** One minute is the minimum practical polling interval for a shared Gmail inbox. Lowering it increases Gmail API quota usage. The Gmail API default quota is 250 quota units per second; each `list` call costs 5 units, each `get` costs 5 units, and `markAsRead` costs 5 units.

**Token refresh is silent.** The Google OAuth2 client refreshes tokens automatically and fires a `tokens` event. The worker catches this and writes the new tokens to `oauth_connections`. There is no log entry for successful token refresh. Failed refresh appears in `gmail_operation_errors`.

**The admin web app caches route data.** Next.js caches `page.tsx` server component data by default. After making changes via `saveNewVersion()` or other server actions, `revalidatePath('/admin/prompts')` is called. If a page still shows stale data after an action, check whether `revalidatePath` is being called for that route.

---

## Cross-references

- `reference/env-vars.md` (full env var list)
- `architecture/decisions.md` ADR 1 (why Bedrock), ADR 9 (two dedicated IAM users)
- `operations/monitoring.md` (admin UI pages)
- `operations/troubleshooting.md` (startup failures, Gmail errors)
- `reference/database-schema.md` (`oauth_connections`, `clients`, `routing_rules`)
