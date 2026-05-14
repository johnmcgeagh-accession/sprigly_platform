# Sprigly Engine — Architecture Notes

## Bedrock model availability

Production inference runs on AWS Bedrock in `eu-west-2` via cross-region inference profiles routing within the EU. The worker IAM user is `sprigly-bedrock-worker`.

**As of 2026-05-14:**

| Logical name | Cross-region inference profile ID | Status |
|---|---|---|
| `haiku` | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | ✅ Available |
| `sonnet` | `eu.anthropic.claude-sonnet-4-6` | ✅ Available |
| `opus` | `eu.anthropic.claude-opus-4-7` | ❌ AWS-side availability gate — support case raised |

All production workflows must use `haiku` or `sonnet` until Opus access is provisioned.

Logical names are declared per workflow step in `packages/workflows/src/meta.ts` and resolved to physical IDs at worker startup via `BEDROCK_MODEL_ID_HAIKU/SONNET/OPUS` env vars. See `packages/model-client/src/factory.ts` for resolution logic.

---

## Credential isolation

Two dedicated IAM users, each with the minimum required policy:

| IAM user | Purpose | Policy | Env vars |
|---|---|---|---|
| `sprigly-bedrock-worker` | Bedrock model inference | `AmazonBedrockFullAccess` (scoped to eu-west-2) | `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY` |
| `sprigly-kms-worker` | KMS data key encrypt/decrypt | `AWSKeyManagementServicePowerUser` (scoped to key ARN) | `KMS_AWS_ACCESS_KEY_ID`, `KMS_AWS_SECRET_ACCESS_KEY` |

The generic `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars are not used. Each SDK client receives explicit credentials at construction time.

---

## Model resolution

Workflows declare logical model names (`haiku`, `sonnet`, `opus`). These are resolved to physical provider IDs at worker startup by `ResolvedModelClient` in `packages/model-client/src/model-resolver.ts`.

| Logical name | Anthropic direct ID | Bedrock cross-region profile ID |
|---|---|---|
| `haiku` | `claude-haiku-4-5` | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `sonnet` | `claude-sonnet-4-6` | set via `BEDROCK_MODEL_ID_SONNET` |
| `opus` | `claude-opus-4-7` | set via `BEDROCK_MODEL_ID_OPUS` (not yet provisioned) |

Physical IDs for Bedrock are supplied at deploy time via `BEDROCK_MODEL_ID_HAIKU/SONNET/OPUS` env vars. The factory validates all three are present on startup when `MODEL_PROVIDER=bedrock`.

---

## Provider switching

| Env | Use case |
|---|---|
| `MODEL_PROVIDER=bedrock` | Production — all inference via AWS Bedrock eu-west-2 |
| `MODEL_PROVIDER=anthropic` | Dev / rollback — inference via Anthropic API directly |

Switching providers requires only the env var change and a worker restart. No code changes needed. Both providers use the same logical model names, so workflow behaviour is identical.

Cost rates adjust automatically: `packages/audit/src/price-map.ts` detects provider from the physical model ID (Bedrock IDs start with `eu.` or `us.`).

---

## Registered workflows

| Workflow ID | Description | Steps | Models used |
|---|---|---|---|
| `sprigly-blog-post` | Generates a full SEO blog post from a topic brief | research, structure, write | haiku |
| `sprigly-prospect-research` | Researches a prospect firm; produces AI use-case briefing for discovery call | research | haiku |

---

## Dry-run mode

`WorkflowContext.dryRun = true` signals that a run is non-production:

- **Audit logger**: log model calls to console; skip DB writes
- **Destinations**: must skip actual delivery (DB inserts, email sends)
- **Workflow logic**: no change — runs normally

Used by the eval harness (`apps/worker/scripts/eval-harness.ts`) to run workflows against real model providers without touching the production DB or sending emails.
