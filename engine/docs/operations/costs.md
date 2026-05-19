# Costs

## How costs are calculated

Every model call writes a row to `audit_log` including `input_tokens`, `output_tokens`, and `cost_pence`. `cost_pence` is computed by `computeCostPence()` in `packages/audit/src/price-map.ts`.

The function:
1. Detects the model family (`haiku`, `sonnet`, `opus`) from the model ID string.
2. Detects the provider: IDs starting with `eu.` or `us.` are Bedrock; others are Anthropic.
3. Looks up the rate from the `RATES` table.
4. Returns `Math.ceil((inputTokens / 1M) × inputRate + (outputTokens / 1M) × outputRate)`.

**Current rates (pence per 1M tokens):**

| Family | Provider | Input | Output |
|---|---|---|---|
| haiku | anthropic | 60 | 320 |
| haiku | bedrock | 69 | 368 |
| sonnet | anthropic | 240 | 1,180 |
| sonnet | bedrock | 276 | 1,357 |
| opus | anthropic | 1,180 | 5,930 |
| opus | bedrock | 1,357 | 6,820 |

Bedrock rates are approximately 15% higher than Anthropic direct. This reflects the cross-region inference premium (eu-west-2). The 15% figure was verified empirically against two eval runs on 2026-05-14.

Rates are stored in `RATES` in `price-map.ts`. To update after a pricing change: edit that table. No other code changes are needed.

---

## Empirical cost data

Three eval runs from 2026-05-14 with 8 fixtures each (5 blog posts, 3 prospect parse steps).

### 2026-05-14T10:23:56 (all 8 passing)

The cleanest run -- all 8 fixtures passed on both providers.

| Provider | Total | Avg per run |
|---|---|---|
| anthropic | £0.0475 | £0.0059 |
| bedrock | £0.0546 | £0.0068 (+15%) |

Per-fixture costs on Bedrock:

| Fixture | Bedrock cost | Notes |
|---|---|---|
| blog-01 | £0.0092 | |
| blog-02 | £0.0093 | |
| blog-03 | £0.0097 | |
| blog-04 | £0.0095 | |
| blog-05 | £0.0093 | |
| prospect-01 | £0.0028 | Write step only (no web search in eval) |
| prospect-02 | £0.0028 | |
| prospect-03 | £0.0022 | |

### 2026-05-14T09:41:54 (0/8 passing — em-dash regression)

All 8 fixtures failed `mustNotContain: "—"`. The em-dash check was catching em-dashes that the model was producing despite the `WRITE_SYSTEM` prompt instruction. The costs were similar to the passing run, confirming that per-call costs are stable regardless of whether output passes eval assertions.

| Provider | Total | Avg per run |
|---|---|---|
| anthropic | £0.0463 | £0.0058 |
| bedrock | £0.0551 | £0.0069 (+19%) |

The higher +19% premium in this run vs +15% in the clean run reflects natural token count variation between runs.

### 2026-05-14T08:46-20 (7/8 passing — step-level eval)

An earlier format eval using per-step fixtures (individual research, structure, write steps rather than full end-to-end blog runs). One fixture failed due to a `max_tokens` truncation (prospect-research-02 hit the output token limit).

Per-step costs on Bedrock:

| Step | Input tokens | Output tokens | Bedrock cost |
|---|---|---|---|
| blog-research (typical) | 152-157 | 683-775 | ~$0.0033-0.0037 |
| blog-structure (typical) | 242 | 145-152 | ~$0.0009 |
| blog-write (typical) | 180 | 1,124-1,188 | ~$0.0053 |
| prospect-research (parse step) | 201-225 | 519-760 | ~$0.0022-0.0039 |

(These costs are in USD from the eval report format at that time.)

---

## Per-workflow cost estimates

### `sprigly-blog-post`

**Typical range (Bedrock, Haiku):** £0.009 -- £0.010 per full blog post run (3 steps combined).

**Breakdown:**
- Research step: ~£0.003 (low token count, short prompt, medium output)
- Structure step: ~£0.001 (very short output, ~150 tokens)
- Write step: ~£0.005-0.006 (highest output token count, ~1,000-1,200 tokens)

**Worst case:** If `clientConfig.settings['model']` is set to `'sonnet'`, all three steps run at Sonnet rates. Estimated worst case: ~£0.10-0.15 per run (10-15x Haiku cost).

### `sprigly-prospect-research`

**Typical range (Bedrock, Sonnet):** Costs are highly variable because the research step uses web search. A run that issues 10 Tavily searches (10 tool turns at Sonnet rates) produces substantially more tokens than a run that needs 3 searches.

**Low estimate (3 tool turns):** ~£0.03-0.05 per run.
**High estimate (20 tool turns / force-summarise):** ~£0.20-0.30 per run.

The research step is the dominant cost driver. The write step (~£0.02-0.05) and PDF render (no model cost) are secondary.

**Tavily costs** are additional: $0.04 per search beyond the free tier (1,000 free searches/month). With 5-15 searches per run, that is $0.20-0.60 per run in search costs alone once you exceed the free tier.

### `sprigly-meeting-prep`

Not in production. One `sonnet` step, `maxTokens: 4000`. Estimated cost similar to the prospect-write step: £0.02-0.05 per run depending on output length.

---

## Monitoring costs

The admin UI at `/admin/audit` shows per-call costs. For aggregate views, query `audit_log` directly:

```sql
-- Total cost this month by workflow step
SELECT action, SUM(cost_pence) AS total_pence, COUNT(*) AS calls,
       SUM(input_tokens) AS total_input, SUM(output_tokens) AS total_output
FROM audit_log
WHERE created_at > DATE_TRUNC('month', NOW())
GROUP BY action
ORDER BY total_pence DESC;

-- Average cost per client
SELECT client_id, SUM(cost_pence) AS total_pence, COUNT(*) AS calls
FROM audit_log
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY client_id
ORDER BY total_pence DESC;
```

---

## Gotchas

**`computeCostPence` returns 0 for unknown model IDs.** If the model ID does not contain `haiku`, `sonnet`, or `opus`, the function returns 0 and the audit row shows `£0.00`. This can happen if a non-standard model ID is used. Check the `audit_log.model_id` column for unusual values if costs appear unexpectedly zero.

**Bedrock Opus is flagged as a placeholder.** The `RATES.opus.bedrock` entry has a comment: "placeholder -- not yet available on Bedrock eu-west-2". If Opus is used via Bedrock before this is verified, the cost calculation may be wrong. Verify the actual price from the AWS Bedrock pricing page and update `RATES` before using Opus in production.

**Costs are computed at call time from the token counts returned by the model provider.** If the provider's token count differs from the actual billing count (e.g. due to system prompt tokenisation), the computed cost will drift from the actual invoice. Use the `audit_log` costs for operational visibility, not for billing accuracy.

---

## Cross-references

- `reference/env-vars.md` (`BEDROCK_MODEL_ID_*` env vars)
- `operations/monitoring.md` (audit log admin UI page)
- `reference/database-schema.md` (`audit_log` table)
- `infrastructure/model-client.md` (max tool turns, Bedrock timeout)
- `infrastructure/web-search.md` (Tavily cost per search)
