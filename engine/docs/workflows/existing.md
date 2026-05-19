# Existing Workflows

Two workflows are registered and running in production. One is a scaffold skeleton, not yet operational.

---

## `sprigly-prospect-research`

**Status:** Production. Registered with the worker.

**Trigger:** Email with subject starting `Prospect:` (case-insensitive matching is handled by routing rules; `parseProspectInput()` in `parse-input.ts` matches case-insensitively via `parseEmailInput()`).

**What it does:** Researches a prospect company using web search, writes a structured brief, renders it as a PDF, and replies to the sender with the PDF attached.

**Location:** `packages/workflows/src/sprigly-prospect-research/`

### Input

Parsed by `parseProspectInput()` via `parseEmailInput()`:

| Field | Source | Required? |
|---|---|---|
| `brandName` | Subject line after `Prospect:` | Yes |
| `url` | Body field `URL` / `url` / `website` | No |
| `sector` | Body field `Sector` / `sector` / `industry` | No |
| `meetingDate` | Body field `Meeting Date` / `meeting date` / `date` | No |
| `whyInterested` | Body field `Why Interested` / `why interested` / `why` | No |
| `notes` | Body field `Notes` / `notes` / `background` | No |

Example trigger email:
```
Subject: Prospect: Acme Corp
Body:
URL: https://acme.com
Sector: SaaS
Meeting Date: 12 Jun 2026
Why Interested: cold outreach, referral from Jamie
Notes: Focus on their ops automation product. Avoid mentioning the 2024 rebrand.
```

### Steps

**Step 1: Research** (`step_name='research'`)
- Model: `sonnet` (hardcoded, not overridable)
- Tools: `web_search` via Tavily. Up to 20 tool turns.
- Input variables: all 7 from `buildTemplateVars()` -- `brandName`, `url`, `sector`, `meetingDate`, `whyInterested`, `notes`, `today`
- Audit action: `prospect-research`
- Output: raw model text (passed to write step as `{{research}}`)

**No-data short-circuit:** If `ctx.search` is present AND `searchCount.total >= 10` AND all searches returned no results (`searchCount.empty === searchCount.total`), the write step is skipped. `renderNoData(input.brandName)` is called and the workflow returns `{ pdf, noDataAvailable: true, brandName }`.

**Step 2: Write** (`step_name='write'`)
- Model: `sonnet` (hardcoded)
- Tools: none
- System prompt: `WRITE_SYSTEM` constant (hardcoded at `sprigly-prospect-research.ts:11`): enforces JSON-only output, bans em-dashes
- Input variables: all 7 from `buildTemplateVars()` + `{{research}}` (the research step text)
- Audit action: `prospect-write`
- Output: JSON parsed into `ProspectBriefData` via `normalizeBriefData()`

`normalizeBriefData()` coerces the raw LLM JSON with `safeString()` and `safeArray()` fallbacks throughout. It never throws on partial output -- it fills missing fields with empty strings and empty arrays. This defensive coercion is necessary because the write step can produce partial output when research is sparse.

**Step 3: Render PDF** (no model call)
- Calls `render('prospect-brief', data)` from `@sprigly/pdf-render`
- Returns a `Buffer`
- No audit log entry (no model call)

### Output

```typescript
interface ProspectOutput {
  data?: ProspectBriefData;    // undefined on noDataAvailable path
  pdf: Buffer;
  noDataAvailable?: boolean;
  brandName?: string;
  summaryBullet1?: string;     // from execSummary.whatTheyActuallyDo
  summaryBullet2?: string;     // from pipelines[0]: "${name} — ${qualifier}"
  summaryBullet3?: string;     // from risks[0]: "${title} — ${detail}"
}
```

`summaryBullet2` and `summaryBullet3` are absent when the write step produced no pipelines or risks. The `gmail-reply-with-attachment` body template uses these three bullets in the reply email. If they are absent, those lines render as empty strings (via `substituteTemplate()`).

### Destinations (default)

1. `db-save-output` — saves `data` (not `pdf`) to `workflow_outputs`
2. `gmail-reply-with-attachment` — replies to sender with PDF:
   - Subject: `Prospect brief: {{brandName}}`
   - Body: three-bullet summary + "PDF attached."
   - Filename: `{{brandName}}-prospect-brief.pdf`

Both destinations are in `defaultDestinations` and fire unless a routing rule overrides them.

---

## `sprigly-blog-post`

**Status:** Production. Registered with the worker.

**Trigger:** Email with subject starting `Blog:` (matched by `parseBlogPostInput()` using a simple `startsWith` check -- case-insensitive via `.toLowerCase()`).

**What it does:** Researches a topic, structures a post, writes it, and saves it to `blog_posts`. No PDF, no email reply.

**Location:** `packages/workflows/src/sprigly-blog-post/`

### Input

Parsed inline in `parseBlogPostInput()` (`parse-input.ts`). Does not use `parseEmailInput()`.

| Field | Source | Required? |
|---|---|---|
| `topic` | Subject line after `Blog:` | Yes |

Example trigger email:
```
Subject: Blog: How small law firms can automate client intake
```

No body fields are read.

### Steps

Model selection: `(ctx.clientConfig.settings['model'] as string) ?? 'haiku'`. This is the only workflow where the model is client-configurable. Set `settings.model` to `'sonnet'` or `'opus'` per client in `client_configs` to override.

System prompt: `buildSystemPrompt(ctx)` injects `clientConfig.authorName` and `clientConfig.brandVoice`:
```
You are a professional content writer for {authorName}.
Brand voice: {brandVoice}
Always respond with valid JSON when asked for structured data.
```

**Step 1: Research** (`step_name='research'`)
- Model: from `clientConfig.settings['model']` (default `haiku`)
- Tools: none (no web search)
- Input variables: `{{topic}}`
- `maxTokens`: 5000
- Audit action: `blog-research`
- Output: JSON parsed as `ResearchResponse` (`targetKeyword`, `angles`, `faq`, `researchNotes`)

**Step 2: Structure** (`step_name='structure'`)
- Model: same as research
- Input variables: `{{topic}}`, `{{research}}` (JSON-stringified `ResearchResponse`)
- `maxTokens`: 1000
- Audit action: `blog-structure`
- Output: JSON parsed as `StructureResponse` (`title`, `excerpt`, `metaDescription`, `category`, `cta`)

**Step 3: Write** (`step_name='write'`)
- Model: same as research
- Input variables: `{{topic}}`, `{{research}}`, `{{title}}`, `{{keyword}}`
- `maxTokens`: 3000
- Audit action: `blog-write`
- Output: raw markdown text (stored directly as `body`)

### Output

```typescript
interface BlogPostOutput {
  title: string;
  slug: string;           // generated by generateSlug(title)
  body: string;           // raw markdown from the write step
  excerpt: string;
  metaDescription: string;
  targetKeyword: string;
  category: string;
  author: string;         // from ctx.clientConfig.authorName
  cta: string;
  researchNotes: string;
  faq: Array<{ question: string; answer: string }>;
  topic: string;
}
```

### Destinations (default)

1. `db-save-blog-post` — writes the post to `blog_posts`. Sets `requireApproval: false`. Generates `previewToken` and `publishToken`. Handles slug uniqueness (appends `-2`, `-3`, etc. up to 100 attempts).

---

## `sprigly-meeting-prep`

**Status:** Scaffold skeleton. NOT registered with the worker. Cannot be triggered.

The workflow struct exists and compiles. It is not in the `workflows` array passed to the consumer in `apps/worker/src/index.ts`. No routing rule targets it. No one can trigger it via email today.

**Why it exists:** It was scaffolded using `pnpm new-workflow` to establish the pattern for a meeting preparation workflow. The implementation is intentionally minimal -- one step, no PDF, raw text output -- so that the shape is right before the actual prompt is written.

**Location:** `packages/workflows/src/sprigly-meeting-prep/`

### What exists

| File | Status |
|---|---|
| `types.ts` | Stub: `SpriglyMeetingPrepInput` (`topic`, optional `notes`) and `SpriglyMeetingPrepOutput` (`text: string`) |
| `parse-input.ts` | Complete: `parseMeetingPrepInput()` using `parseEmailInput()` with subject prefix `Meeting Prep:` |
| `sprigly-meeting-prep.ts` | Working skeleton: one generate step, `sonnet`, sentinel guard, `maxTokens: 4000` |
| `sprigly-meeting-prep.test.ts` | Tests present: sentinel guard test, happy path with mocked prompt |

### The sentinel guard

`sprigly-meeting-prep.ts:28`:
```typescript
if (prompt.includes('__PROMPT_NOT_CUSTOMISED__')) {
  throw new Error(
    'Prompt template for sprigly-meeting-prep step "generate" has not been customised. ' +
    'Edit the prompt in the admin UI or in the seed migration before running.',
  );
}
```

The seeded global default prompt (migration `0006_sprigly_meeting_prep_prompts.sql`) contains `__PROMPT_NOT_CUSTOMISED__`. If someone registers the workflow and triggers a run before replacing the prompt, the guard throws immediately. This prevents silent garbage output.

### How to put it into production

1. Write the actual prompt and update the seed migration (or insert via admin UI).
2. Register the workflow in `apps/worker/src/index.ts` alongside the other two.
3. Create a routing rule for the `Meeting Prep:` subject prefix.
4. Decide whether the output should remain raw text or be extended to a PDF (`--with-pdf` flag on `pnpm new-workflow` generates the PDF skeleton).
5. Add integration tests to the eval harness.

Until steps 1-3 are done, the workflow is inert.

---

## Cross-references

- `workflows/anatomy.md` (shared/hardcoded/prompt-controlled three-column tables for all three workflows)
- `workflows/prompts.md` (`__PROMPT_NOT_CUSTOMISED__` sentinel; `fillTemplate()` variable substitution)
- `workflows/adding-a-workflow.md` (how to complete or create a workflow)
- `infrastructure/destinations.md` (destination settings for `gmail-reply-with-attachment` and `db-save-blog-post`)
- `infrastructure/pdf-render.md` (`render()` and `renderNoData()`)
- `reference/database-schema.md` (`blog_posts`, `workflow_outputs` tables)
