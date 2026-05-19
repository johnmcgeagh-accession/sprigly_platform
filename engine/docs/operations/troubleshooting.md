# Troubleshooting

Known failure modes, verbatim error strings, and resolution steps.

---

## Worker fails to start: model client configuration error

**Error in Railway logs:**
```
Model client configuration error — fix env vars and restart:
  • <field>: <zod error message>
```
or:
```
Failed to create model client
```

**Cause:** `createModelClientFromEnv()` threw a Zod validation error. One or more required Bedrock env vars are missing, have wrong format, or have the wrong value.

**Resolution:**
1. Check Railway env vars for `MODEL_PROVIDER`, `AWS_REGION`, `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID_HAIKU`, `BEDROCK_MODEL_ID_SONNET`, `BEDROCK_MODEL_ID_OPUS`.
2. Do not set the generic `AWS_ACCESS_KEY_ID` -- use `BEDROCK_AWS_ACCESS_KEY_ID`. See `reference/env-vars.md`.
3. Fix the var and redeploy.

---

## Worker fails to start: no encryption provider

**Error in Railway logs:**
```
oauth-tokens: set AWS_KMS_KEY_ID (production) or LOCAL_DEV_ENCRYPTION_KEY (development)
```

**Cause:** `createEncryptionProvider()` found neither `AWS_KMS_KEY_ID` nor `LOCAL_DEV_ENCRYPTION_KEY` in env.

**Resolution:** Set `AWS_KMS_KEY_ID` to the KMS key ARN. For local dev, set `LOCAL_DEV_ENCRYPTION_KEY` to a 32-byte base64 string.

---

## Workflow run fails: logical model name not mapped

**Error in `workflow_runs.error`:**
```
Logical model name "opus" is not mapped to a physical ID. Check BEDROCK_MODEL_ID_OPUS / ANTHROPIC_MODEL_ID_OPUS env vars.
```

**Cause:** A workflow is calling `ctx.model.complete({ model: 'opus', ... })` but `BEDROCK_MODEL_ID_OPUS` is not set or is empty. This happens when a client-configurable workflow (`sprigly-blog-post`) has `clientConfig.settings['model'] = 'opus'` set but the Opus model ID env var is missing.

**Resolution:** Set `BEDROCK_MODEL_ID_OPUS` to the Bedrock cross-region inference profile ID for Claude Opus. Example: `eu.anthropic.claude-opus-4-7-20250514-v1:0`.

---

## Workflow run fails: Bedrock timeout

**Error in `workflow_runs.error`:**
```
Bedrock request timed out after 180s for model eu.anthropic.claude-sonnet-4-5-20251001-v1:0
```

**Cause:** The `sprigly-prospect-research` research step ran up to or near MAX_TOOL_TURNS (20) Tavily searches, and the total Bedrock call chain exceeded 180 seconds.

**Resolution:**
- Check the `audit_log` row for `prospect-research` and look at `metadata.toolTurns`. If it is at or near 20, the force-summarise path was hit.
- The prompt instructs the model to search efficiently. If tool turns are consistently at 20, the research prompt may need to be tightened.
- No code change is needed for a one-off timeout. The triggering email can be resent.

---

## Workflow run fails: Tavily operator rejection

**Error in `workflow_runs.error`:**
```
Query contains unsupported search operators: "site:linkedin.com John Smith". Tavily requires natural language queries only. Remove site:, intitle:, inurl:, quoted phrases, and minus operators.
```

**Cause:** The research prompt (or the model's generated query) included a Google-style search operator. Tavily rejects these before making a network call.

**Resolution:**
- The research prompt for `sprigly-prospect-research` explicitly instructs the model not to use operators. If this error appears, the model disobeyed the instruction.
- Update the research prompt to restate the constraint more firmly, or add it as a system prompt rather than a user prompt message.
- The `OPERATOR_RE` pattern is `\bsite:|\bintitle:|\binurl:|\bfiletype:|"[^"]+"|\bOR\b|(?:^|\s)-\S`. It catches common operator patterns but is not exhaustive.

---

## Workflow run fails: no prompt template found

**Error in `workflow_runs.error`:**
```
No prompt template found for workflow=sprigly-your-workflow step=your-step (clientId=<uuid>)
```

**Cause:** `DbPromptResolver.resolve()` found no matching row in `prompt_templates` -- neither client-specific nor global default.

**Resolution:**
1. Check the admin UI (`/admin/prompts`) for a row with the matching `workflow_id` and `step_name`.
2. If no row exists, run the seed migration for that workflow.
3. If the row exists but uses the wrong `workflow_id` or `step_name` string, fix the row (insert a corrected version).
4. The resolver checks exact string match -- check for trailing spaces or capitalisation differences.

---

## Workflow run fails: sprigly-meeting-prep sentinel

**Error in `workflow_runs.error`:**
```
Prompt template for sprigly-meeting-prep step "generate" has not been customised. Edit the prompt in the admin UI or in the seed migration before running.
```

**Cause:** The `sprigly-meeting-prep` workflow was registered with the worker before a real prompt was written. The seeded prompt still contains `__PROMPT_NOT_CUSTOMISED__`.

**Resolution:** This workflow is not supposed to be registered until the prompt is ready. Either:
- Write the actual prompt via the admin UI (create a new version of the `sprigly-meeting-prep / generate` row)
- Or unregister the workflow from `apps/worker/src/index.ts` and redeploy

---

## Email arrives but no workflow run is created

**Symptoms:** An email was sent with the correct subject prefix. The Gmail inbox shows it as read (the worker marked it). No `incoming_events` row was created. No `workflow_runs` row exists.

**Causes and checks:**

1. **No matching routing rule.** The `matchRules()` evaluation returned no results. Check `/admin/routing-rules` -- verify there is an enabled rule for that client and subject prefix. The condition operator and value must match exactly (case handling: `contains`, `startsWith`, `equals` are case-insensitive by default; `regex` uses the `i` flag).

2. **Routing rule is disabled.** `enabled = false` rows are not loaded by `loadRules()`. Re-enable in the admin UI.

3. **Wrong client's Gmail connected.** The email was sent to an address connected to client A, but the routing rule is for client B. Check `oauth_connections` to confirm which client owns that Gmail address.

4. **`processed_external_ids` idempotency.** If a matching `processed_external_ids` row exists, the worker treated the email as already processed and skipped it (without creating an `incoming_events` row). This can happen after a previous failed run that still wrote the idempotency record.

---

## Email arrives but workflow run is ignored

**Symptoms:** `incoming_events` row exists with `status = 'ignored'`. No `workflow_runs` row.

**Cause:** The event was matched by the poller (a routing rule matched during polling), but when the BullMQ consumer re-evaluated the rules, no rules matched. The most common cause is a routing rule being disabled between the poll and the consumer processing the job.

**Resolution:** Re-enable the routing rule. The email must be resent -- ignored events are not retried.

---

## JSONB double-encoding (historical)

**Symptom:** Querying `routing_rules.match_conditions` or `workflow_outputs.output` returns a JSON string literal instead of an object. `jsonb_typeof(col)` returns `'string'` instead of `'object'` or `'array'`.

**Cause:** `postgres.js` v3 re-serializes values that Drizzle has already converted to strings, resulting in double-encoded JSONB (a JSON string containing a JSON string).

**Status:** Fixed. The custom JSON serializer in `packages/db/src/client.ts` prevents new double-encoding. The one-time repair script (`packages/db/src/fix-jsonb-encoding.ts`) and migration (`packages/db/migrations/fix_jsonb_double_encoding.sql`) fixed all existing rows in production.

**If you see new occurrences:** Check whether the custom serializer in `client.ts` is still in place:
```typescript
serialize: (x: unknown) => typeof x === 'string' ? x : JSON.stringify(x),
```
If a package upgrade changed or removed this, restore it. See `architecture/decisions.md` and `packages/db/src/client.ts:12`.

---

## Gmail errors appearing in admin UI

**Symptom:** Dashboard shows "Gmail Errors (24h)" > 0. Errors visible in `/admin/gmail-errors`.

**Cause:** One of `markAsRead()`, `createDraft()`, or `send()` in `GmailApiClient` threw a Google API error. These errors are caught, logged to `gmail_operation_errors`, and do not fail the job.

**Consequence of `markAsRead` failure:** The email remains unread in Gmail. On the next poll cycle, the `processed_external_ids` check will catch it (the idempotency record was already written) and call `markAsRead` again. This produces another error entry. It repeats until the Gmail API recovers.

**Resolution:**
1. Check the `error_message` column for HTTP status. 401/403 means token refresh failed or scopes changed. 429 means Gmail API rate limit.
2. For 401/403: reconnect Gmail OAuth via `tsx apps/worker/src/setup-gmail-oauth.ts <client-slug>`.
3. For 429: the errors are transient. Mark them resolved after the rate limit window clears.
4. Mark resolved via the admin UI once the underlying issue is fixed.

---

## Delivery fails but workflow run shows completed

**Symptom:** `workflow_runs.status = 'completed'` but the client did not receive an email reply or the blog post was not saved.

**Cause:** `DestinationDispatcher.dispatch()` catches per-destination errors and continues. A failed delivery does not mark the run as failed.

**Detection:** Search Railway logs for:
```
[engine] DestinationDispatcher: delivery failed
```

**Resolution:**
- Check the log entry for `destinationId` and error message.
- For `gmail-reply-with-attachment` failures: check `gmail_operation_errors`.
- For `db-save-blog-post` or `db-save-output` failures: check for DB connectivity issues.
- The workflow output is stored in `approvals.output_snapshot` (if approval was required) or may need to be reconstructed by re-running.

---

## Bedrock throttling (ThrottlingException)

**Symptom:** Workflow runs occasionally fail with Bedrock throttle errors. Appears in Railway logs as `job failed` with a Bedrock SDK error.

**Cause:** Bedrock cross-region inference has per-account rate limits. The `BedrockClient` retries up to 3 times with exponential backoff (2s, 4s) before re-throwing. If the throttle persists across 3 retries, the job fails.

**Resolution:**
- Check for concurrent runs: if 10 BullMQ jobs are running simultaneously (concurrency=10) and all hit Bedrock, throttling is expected.
- Reduce `concurrency` in `createConsumer()` if throttling is persistent.
- Request a Bedrock quota increase in the AWS Console (Support → Service Quotas → Amazon Bedrock).

---

## Cross-references

- `reference/env-vars.md` (full env var list)
- `operations/deployment.md` (startup sequence, Railway setup)
- `operations/monitoring.md` (admin UI and log patterns)
- `infrastructure/model-client.md` (Bedrock timeout, throttle retry logic)
- `infrastructure/web-search.md` (Tavily operator rejection)
- `infrastructure/sources.md` (Gmail polling, idempotency, `markAsRead` failure)
