# Sprigly Engine — Data Handling

## Production inference

All model inference in production runs on **AWS Bedrock** in `eu-west-2` via cross-region inference profiles. Traffic is routed within the EU and does not leave AWS EU infrastructure.

**Cross-region inference profiles** allow Bedrock to route requests across EU availability zones for resilience while keeping data within the EU. The profile IDs used follow the `eu.anthropic.*` naming convention.

Model calls are made by the `sprigly-bedrock-worker` IAM user, which has no access to data outside Bedrock inference.

---

## Sub-processors

| Sub-processor | Role | Region | Data sent |
|---|---|---|---|
| **Anthropic** | Model creator — trains and maintains the Claude models | N/A (model weights hosted by AWS) | None directly — Anthropic provides models to AWS; prompts are not sent to Anthropic infrastructure in production |
| **AWS (Bedrock)** | Inference infrastructure — hosts and serves the models | EU (eu-west-2, cross-region within EU) | System prompts, user prompts, model output |
| **AWS (KMS)** | Key management — envelope encryption for OAuth tokens | eu-west-2 | Encrypted data keys only; plaintext content never sent to KMS |
| **Railway** | Database hosting (PostgreSQL) | EU | Structured application data, audit logs, encrypted OAuth tokens |

---

## Match-all routing rules

A routing rule can be configured to match every incoming email by leaving its conditions array empty. This is useful for clients who want every email processed by a workflow. When such a rule is active, all incoming emails are persisted to `incoming_events` (since they all match a rule). This is by design — the client has explicitly chosen to route every email. Without a match-all rule, only emails matching specific conditions are persisted.

## Fallback routing rules

A routing rule can be marked as fallback (`is_fallback = true`), meaning it only fires when no non-fallback routing rule matched the email. Useful for "catch-all" workflows that handle anything not picked up by more specific rules. Fallback rules are evaluated with the same condition logic as regular rules — the fallback flag only changes whether they are returned when a primary rule has already matched.

---

## OAuth scopes

The Gmail OAuth connection requests the following scopes:

| Scope | Purpose |
|---|---|
| `gmail.readonly` | Read inbox messages for workflow triggers |
| `gmail.modify` | Mark messages as read; create draft replies |
| `gmail.send` | Send notifications from client mailbox |

**NOT granted:** `gmail.compose`, `mail.google.com` (full account access), or any Google Drive, Calendar, or Contacts scope.

Tokens are per-client, stored encrypted using KMS envelope encryption (see Encryption section), and scoped to a single Gmail account.

---

## Model availability

Models in use as of 2026-05-14:

| Model | Logical name | Bedrock status |
|---|---|---|
| Claude Haiku 4.5 | `haiku` | Available |
| Claude Sonnet 4.6 | `sonnet` | Available |
| Claude Opus 4.7 | `opus` | Pending AWS provisioning — support case raised |

All current production workflows use `haiku`. The engine supports `sonnet` for use cases requiring higher quality output; `opus` is declared in the model map but cannot be invoked until AWS completes provisioning.

---

## Encryption

### OAuth tokens

OAuth tokens (Gmail, Google Calendar, etc.) are encrypted at rest using **KMS envelope encryption**:

1. On write: AWS KMS generates a per-client data key. The plaintext key encrypts the token; only the encrypted key and encrypted token are stored in the database.
2. On read: KMS decrypts the data key; the plaintext key decrypts the token in memory. The plaintext key is never persisted.
3. KMS operations use the `sprigly-kms-tokens` IAM user, which is scoped to a single KMS key ARN and has no access to Bedrock or application data.

### Data at rest

All application data is stored in PostgreSQL on Railway. Railway encrypts volumes at rest (AES-256). The database is not publicly accessible — the worker connects via private networking.

### Data in transit

All connections use TLS: worker → Railway (PostgreSQL over TLS), worker → AWS Bedrock (HTTPS/TLS), worker → KMS (HTTPS/TLS).

---

## Email content filtering

Email content from incoming emails is only persisted when at least one active routing rule matches. Emails outside the scope of configured workflows are read, tracked by Gmail message ID for idempotency (`processed_external_ids`), and discarded without storing content.

This means:
- Personal data in emails that don't match any workflow is never written to the database.
- The idempotency record (`processed_external_ids`) contains only the Gmail message ID, client ID, source, and processed timestamp — no subject, body, sender, or recipient.
- If a routing rule is later added that would have matched a previously discarded email, that email will not be retroactively processed.

---

## Audit logging

Every model call is written to the `audit_log` table with:
- `client_id`, `event_id`, `workflow_run_id`
- `model_id` — full physical model ID (e.g. `eu.anthropic.claude-haiku-4-5-20251001-v1:0`)
- `input_tokens`, `output_tokens`
- `cost_pence` — computed from `packages/audit/src/price-map.ts` at write time

Prompts and model output are **not** stored in audit logs. The audit log records metadata only.
