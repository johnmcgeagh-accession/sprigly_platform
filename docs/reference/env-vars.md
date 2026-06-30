# Environment Variables

Every environment variable read by the Sprigly engine. Grouped by subsystem.

Sources consulted: `apps/worker/src/env.ts`, `packages/model-client/src/factory.ts`, `packages/db/src/client.ts`, `packages/oauth-tokens/src/providers.ts`, `packages/web-search/src/tavily-provider.ts`, `apps/web/src/middleware.ts`, `.env.example`.

---

## Database

| Variable | Required | Example | Where used |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pw@host:5432/sprigly` | `packages/db/src/client.ts` — passed to `postgres()` to create the connection pool. Both worker and web app read this. |

---

## Model provider

| Variable | Required | Example | Notes |
|---|---|---|---|
| `MODEL_PROVIDER` | Yes | `anthropic` or `bedrock` | Selects the inference backend. Worker startup fails immediately if absent or invalid. Parsed first by `createModelClientFromEnv()` in `packages/model-client/src/factory.ts`. |

### When `MODEL_PROVIDER=anthropic`

| Variable | Required | Example | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | `sk-ant-...` | Passed directly to `AnthropicClient`. No default. |
| `ANTHROPIC_MODEL_ID_HAIKU` | No | `claude-haiku-4-5` | Defaults to `claude-haiku-4-5` if absent. Resolved at factory construction, not per call. |
| `ANTHROPIC_MODEL_ID_SONNET` | No | `claude-sonnet-4-6` | Defaults to `claude-sonnet-4-6`. |
| `ANTHROPIC_MODEL_ID_OPUS` | No | `claude-opus-4-7` | Defaults to `claude-opus-4-7`. |

Anthropic defaults use versionless aliases. Anthropic routes these to the latest patch release in each family automatically.

### When `MODEL_PROVIDER=bedrock`

| Variable | Required | Example | Notes |
|---|---|---|---|
| `AWS_REGION` | No | `eu-west-2` | Defaults to `eu-west-2`. Applies to both Bedrock inference and KMS. |
| `BEDROCK_AWS_ACCESS_KEY_ID` | Conditional | `AKIA...` | Must be set together with `BEDROCK_AWS_SECRET_ACCESS_KEY`. Omit both when running on an IAM role (e.g. ECS task role, Railway attached policy). |
| `BEDROCK_AWS_SECRET_ACCESS_KEY` | Conditional | `...` | See above. |
| `BEDROCK_MODEL_ID_HAIKU` | Yes | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | Cross-region inference profile ID. Bedrock has no versionless aliases -- these IDs expire when models are updated. Find current IDs at: AWS Console, Amazon Bedrock, Model access, Cross-region inference. |
| `BEDROCK_MODEL_ID_SONNET` | Yes | `eu.anthropic.claude-sonnet-4-6` | Same note as above. |
| `BEDROCK_MODEL_ID_OPUS` | Yes | `eu.anthropic.claude-opus-4-7-...` | Required at startup even though Opus is not yet provisioned on Bedrock eu-west-2. Set to any non-empty string if Opus access is not needed. See `ARCHITECTURE.md` note on Opus provisioning. |

**Do not use `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`** (the generic AWS SDK defaults). The worker deliberately ignores them to prevent credential mix-ups. All AWS clients receive explicit credentials from the dedicated `BEDROCK_*` or `KMS_*` vars. See `architecture/decisions.md` ADR 9.

---

## Encryption (KMS / OAuth tokens)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `AWS_KMS_KEY_ID` | Prod only | `arn:aws:kms:eu-west-2:123456789012:key/...` | Master KMS key ARN. When set, the worker uses KMS envelope encryption for OAuth tokens. When absent, falls back to `LOCAL_DEV_ENCRYPTION_KEY`. Logic in `packages/oauth-tokens/src/providers.ts:createEncryptionProvider()`. |
| `KMS_AWS_ACCESS_KEY_ID` | Conditional | `AKIA...` | Must be set together with `KMS_AWS_SECRET_ACCESS_KEY`, or both absent. Omit when running on an IAM role. |
| `KMS_AWS_SECRET_ACCESS_KEY` | Conditional | `...` | See above. |
| `LOCAL_DEV_ENCRYPTION_KEY` | Dev only | `base64-encoded-32-bytes` | Used when `AWS_KMS_KEY_ID` is absent. Must decode to exactly 32 bytes. Worker logs a warning on startup. Never use in production. |

---

## Web search

| Variable | Required | Example | Notes |
|---|---|---|---|
| `TAVILY_API_KEY` | Yes | `tvly-...` | Validated by `TavilyProvider` constructor in `packages/web-search/src/tavily-provider.ts`. Throws on startup if absent. |

---

## Redis / BullMQ

| Variable | Required | Example | Notes |
|---|---|---|---|
| `REDIS_URL` | Yes | `redis://localhost:6379` | Parsed by `apps/worker/src/env.ts`. Used to create the BullMQ `Queue` and `Worker` connection. Both must use the same Redis URL. |

---

## Gmail OAuth

| Variable | Required | Example | Notes |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | `1234567890-abc.apps.googleusercontent.com` | Google OAuth2 client ID. Used by `GmailPoller` and all Gmail destination classes. |
| `GOOGLE_CLIENT_SECRET` | Yes | `GOCSPX-...` | Google OAuth2 client secret. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Dev/setup only | `http://localhost:3100/api/oauth/gmail/callback` | Required during the OAuth setup flow (`apps/worker/src/setup-gmail-oauth.ts`). Not read by the worker at runtime. |

---

## Polling

| Variable | Required | Example | Notes |
|---|---|---|---|
| `POLL_INTERVAL_MS` | No | `60000` | Gmail poll interval in milliseconds. Defaults to 60,000 (1 minute). Parsed by `apps/worker/src/env.ts`. |

---

## Authentication (web app only)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes (web) | `pk_live_...` | Clerk publishable key. Read by the Next.js frontend. |
| `CLERK_SECRET_KEY` | Yes (web) | `sk_live_...` | Clerk secret key. Read server-side only. |

The web app uses Clerk for all admin authentication. The worker has no auth layer -- it is not publicly accessible.

---

## Seed / setup

| Variable | Required | Example | Notes |
|---|---|---|---|
| `SPRIGLY_CLIENT_ID` | Seed only | `uuid-v4` | Pre-generated UUID for the initial Sprigly client row. Used by the seed script only. |
| `ADMIN_USER_EMAIL` | Seed only | `john@sprigly.co.uk` | Email address for the initial admin user row. |

---

## Summary: required at worker startup

These variables must be present when `apps/worker/src/index.ts` starts. Missing any of them causes the process to exit before accepting work.

```
DATABASE_URL
REDIS_URL
MODEL_PROVIDER

# If MODEL_PROVIDER=anthropic:
ANTHROPIC_API_KEY

# If MODEL_PROVIDER=bedrock:
BEDROCK_MODEL_ID_HAIKU
BEDROCK_MODEL_ID_SONNET
BEDROCK_MODEL_ID_OPUS

TAVILY_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# One of:
AWS_KMS_KEY_ID           (production)
LOCAL_DEV_ENCRYPTION_KEY (development)
```
