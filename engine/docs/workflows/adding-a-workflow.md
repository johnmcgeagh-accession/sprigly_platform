# Adding a Workflow

## Overview

New workflows are created with the `pnpm new-workflow` scaffold script (`scripts/new-workflow.ts`). It generates the full directory skeleton, a migration for the seed prompt, and updates the two shared manifests. After running it, there are six manual steps before the workflow is operational.

---

## Step 0: Run the scaffold

```bash
pnpm new-workflow <name> [--with-pdf]
```

`<name>` must be lowercase kebab-case (e.g. `contract-review`). The script prepends `sprigly-` if absent, so `contract-review` becomes `sprigly-contract-review`.

`--with-pdf` generates a React PDF component stub in `packages/pdf-render/src/documents/`. Omit it for text-output workflows.

**What the script generates:**

| Path | Contents |
|---|---|
| `packages/workflows/src/<name>/types.ts` | Stub `Input` and `Output` interfaces |
| `packages/workflows/src/<name>/parse-input.ts` | `parseEmailInput()` wired with a `Meeting Prep:`-style subject prefix |
| `packages/workflows/src/<name>/<name>.ts` | One-step skeleton with `__PROMPT_NOT_CUSTOMISED__` sentinel guard |
| `packages/workflows/src/<name>/<name>.test.ts` | Full test suite covering parse, run, sentinel guard |
| `packages/db/migrations/<N>_<name>_prompts.sql` | Idempotent INSERT for the seed prompt with placeholder text |
| `packages/pdf-render/src/documents/<PascalName>.tsx` | (only with `--with-pdf`) PDF component stub |

**What the script updates:**

- `packages/workflows/src/index.ts` — appends export lines for the workflow and its types
- `packages/workflows/src/meta.ts` — appends an entry to `workflowMeta`

The script exits with an error if the workflow directory already exists. It does not touch `apps/worker/src/index.ts` — that step is manual.

---

## Step 1: Define input and output types

Edit `packages/workflows/src/<name>/types.ts`.

Replace the stub `topic: string` input with the fields your workflow actually needs. For a PDF workflow, add `pdf: Buffer` to the output type.

**Input type:** One required field per value you will read. Optional fields for email body fields. All optional fields should be `string | undefined`.

**Output type for PDF workflows:**
```typescript
interface MyOutput {
  data: MyBriefData;
  pdf: Buffer;
  brandName?: string;         // if you need template substitution in the reply email
  // ...other fields for destination template substitution
}
```

**Output type for text workflows:**
```typescript
interface MyOutput {
  text: string;
}
```

---

## Step 2: Set the subject prefix and body fields

Edit `packages/workflows/src/<name>/parse-input.ts`.

Change `titleCase:` in `SPEC.subjectPrefix` to the real subject prefix for your workflow (e.g. `'Contract Review:'`). Update `bodyFields` to match the email fields you expect:

```typescript
const SPEC: EmailInputSpec = {
  subjectPrefix: 'Contract Review:',
  bodyFields: [
    { key: 'party', aliases: ['Party', 'Client name', 'client'] },
    { key: 'notes', aliases: ['Notes', 'Background'] },
    // ...
  ],
};
```

Body field aliases are matched case-insensitively. Add all reasonable label variants. Users will not read docs -- they will use whatever label they type.

Update the result construction below SPEC to map each body field into the input type.

---

## Step 3: Implement the workflow steps

Edit `packages/workflows/src/<name>/<name>.ts`.

The scaffold gives you one step. Real workflows have 2-3. Follow the step pattern from `workflows/anatomy.md`:

```typescript
// 1. Resolve
const prompt = await ctx.prompts.resolve(ctx.clientId, 'sprigly-your-workflow', 'step-name');

// 2. Substitute
const message = fillTemplate(prompt, { key: value, ... });

// 3. Complete
const result = await ctx.model.complete({
  model: 'sonnet',
  messages: [{ role: 'user', content: message }],
  maxTokens: 4096,
});

// 4. Audit
await ctx.audit.logModelCall({
  clientId: ctx.clientId,
  eventId: ctx.eventId,
  runId: ctx.runId,
  modelId: result.modelId,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  action: 'your-step-name',
});

// 5. Parse
const parsed = extractJson(result.content);
```

**Model choice:**
- Use `'haiku'` for fast/cheap steps where quality is not critical.
- Use `'sonnet'` for quality writing and reasoning steps.
- Use `'opus'` for the most complex multi-step reasoning (high cost).
- Only `sprigly-blog-post` reads from `clientConfig.settings['model']` for per-client override. New workflows should hardcode the model unless there is a specific reason for flexibility.

**Web search:** To add Tavily search to a step, follow the pattern in `sprigly-prospect-research.ts:134-180`. Import `WEB_SEARCH_TOOL_DEFINITION` and `handleWebSearchTool` from `@sprigly/web-search`. Pass `tools` and `toolHandlers` to `ctx.model.complete()`. Guard with `if (ctx.search === undefined)` before calling the handler.

**PDF rendering:** Call `render('your-document-type', data)` from `@sprigly/pdf-render`. This returns a `Buffer`. See `infrastructure/pdf-render.md` for the full render() registration checklist.

**Remove the sentinel guard** once you have written a real prompt. The guard exists to prevent garbage output from the scaffold placeholder -- it is not needed in a workflow with a real prompt.

---

## Step 4: Write and seed the prompt

Edit `packages/db/migrations/<N>_<name>_prompts.sql`.

Replace the `__PROMPT_NOT_CUSTOMISED__` placeholder with the actual prompt text. The migration uses a dollar-quoted string, so no SQL escaping is needed.

Document which `{{variables}}` the prompt uses -- the scaffold comment block lists `{{topic}}` and `{{notes}}`. Replace it with the real list.

Run the migration:

```bash
pnpm db:migrate
```

The INSERT is idempotent (guarded by `WHERE NOT EXISTS`). Running the migration again is safe.

If you need to add further steps beyond the scaffold's single `generate` step, add one INSERT per additional `(workflow_id, step_name)` pair to the same migration file.

---

## Step 5: Register the workflow with the worker

Edit `apps/worker/src/index.ts`.

Import the workflow object and add it to the `workflows` array passed to the worker:

```typescript
import { spriglyYourWorkflow } from '@sprigly/workflows';

// In the worker setup:
const workflows = [
  spriglyBlogPostWorkflow,
  spriglyProspectResearchWorkflow,
  spriglyYourWorkflow,          // add here
];
```

The exact wiring depends on how the worker loop is structured. Check the existing two registrations as the pattern to follow.

---

## Step 6: Add a routing rule

No routing rule means no events will ever reach your workflow. Add a rule in the admin UI or via a DB migration.

Minimum rule for email:
- `source`: `email`
- `workflow_id`: `sprigly-your-workflow`
- Condition: `field: 'subject'`, `op: 'startsWith'`, `value: 'Your Prefix:'`
- `enabled`: `true`

If the workflow should also run as a fallback for unmatched emails, set `isFallback: true` with an empty conditions array.

---

## Step 7: Build and test

```bash
pnpm build
pnpm test
```

The generated test file covers:
- `parseInput` happy path and non-matching subject
- Sentinel guard throws correctly
- Model is called exactly N times
- Correct prompt step names are resolved
- Template variables are substituted correctly

Update the `expect(ctx.model.complete).toHaveBeenCalledTimes(1)` assertion when you add more steps.

---

## If `--with-pdf` was used: additional step

The scaffold generates `packages/pdf-render/src/documents/<PascalName>.tsx` with a stub component. You need to wire it into the renderer manually:

1. In `packages/pdf-render/src/render.ts`, add your document type to the `DocumentType` union and `RenderParams` discriminated union.
2. Add a render branch inside `render()` that calls your component.
3. Define a `<PascalName>Data` interface in the component file and export it from `@sprigly/pdf-render`.

See `infrastructure/pdf-render.md` for the full interface and pattern.

---

## Complete checklist

```
[ ] pnpm new-workflow <name> [--with-pdf]
[ ] types.ts — input and output shapes defined
[ ] parse-input.ts — correct subject prefix, correct body fields
[ ] <name>.ts — all steps implemented, sentinel guard removed
[ ] migration SQL — real prompt text, all {{variables}} listed
[ ] pnpm db:migrate
[ ] apps/worker/src/index.ts — workflow registered
[ ] Admin UI or migration — routing rule created and enabled
[ ] pnpm build — no type errors
[ ] pnpm test — all tests passing
[ ] (if --with-pdf) pdf-render/src/render.ts — document type registered
[ ] workflows/existing.md — this doc updated
[ ] workflows/anatomy.md — three-column table updated if non-standard
```

---

## Gotchas

**The script sets the subject prefix to `<Title Case>:`.** `new-workflow contract-review` generates `SPEC.subjectPrefix = 'Contract Review:'`. If your real prefix is different (e.g. `Review:` or `Contract:`), edit `parse-input.ts` before doing anything else. A wrong prefix means the workflow never matches any emails.

**`workflowMeta` is updated but not used for routing.** The `meta.ts` entry is displayed in the admin UI. It does not affect which emails trigger the workflow. Only the routing rule does.

**The migration number is computed from the highest existing `0NNN_` prefix.** If two developers run `pnpm new-workflow` at the same time, they may generate the same migration number. Resolve this by renaming one migration file and its reference in `drizzle.config.ts` (if any).

**`db-save-output` is the only default destination.** The scaffold does not add a reply-by-email destination. If your workflow should reply to the sender, add a `gmail-reply-with-attachment` or `gmail-send-notification` entry to `defaultDestinations` in the workflow file. Match the `settings` shape documented in `infrastructure/destinations.md`.

---

## Cross-references

- `workflows/anatomy.md` (step pattern; workflow interface)
- `workflows/prompts.md` (how `fillTemplate()` works; how to seed a prompt)
- `infrastructure/destinations.md` (destination settings shapes)
- `infrastructure/pdf-render.md` (how to register a new PDF document type)
- `infrastructure/web-search.md` (how to wire Tavily into a step)
