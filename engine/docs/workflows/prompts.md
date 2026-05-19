# Prompt Templates

## Purpose

Prompt text lives in the database, not in code. Every workflow step fetches its prompt at runtime via `ctx.prompts.resolve()`. This means prompt copy can be changed without a code deploy, and each client can have their own version of any prompt.

The resolver is `DbPromptResolver` in `packages/prompts/src/index.ts`. It is injected into every workflow via `WorkflowContext.prompts`.

---

## Interface

### `DbPromptResolver.resolve()`

```typescript
async resolve(clientId: string, workflowId: string, stepName: string): Promise<string>
```

Lookup order:

1. Query `prompt_templates` for a row matching `(clientId, workflowId, stepName)`, ordered by `version DESC`, limit 1.
2. If found: return `promptText`.
3. Query again with `clientId = NULL` (the global default), same `workflowId` and `stepName`.
4. If found: return `promptText`.
5. If neither found: throw `Error: No prompt template found for workflow=${workflowId} step=${stepName} (clientId=${clientId})`.

The resolver never falls back silently. A missing prompt is a hard error that fails the workflow run.

### `prompt_templates` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `client_id` | UUID? | NULL for global defaults; FK to `clients` for client overrides |
| `workflow_id` | text | Must match the workflow's `id` string |
| `step_name` | text | Must match the string passed to `ctx.prompts.resolve()` |
| `prompt_text` | text | The full prompt, including `{{variable}}` placeholders |
| `version` | integer | Monotonically increasing per `(client_id, workflow_id, step_name)` tuple |
| `copied_from_template_id` | UUID? | Set when the row was created by copying a global default |
| `copied_from_version` | integer? | The version of the global row that was copied |

The unique index `prompt_templates_unique_version` enforces `(client_id, workflow_id, step_name, version)` uniqueness. You cannot insert two rows with the same version for the same scope.

---

## Variable substitution

After `resolve()` returns the raw prompt text, each workflow calls its own `fillTemplate()` to substitute `{{variable}}` placeholders:

```typescript
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
```

This is duplicated in each workflow file (`sprigly-prospect-research.ts:17`, `sprigly-blog-post.ts:24`, `sprigly-meeting-prep.ts:7`). Unknown keys produce an empty string, not an error.

**`fillTemplate` only matches `\w+` names** (letters, digits, underscores). Dot-path syntax (`{{data.title}}`) is not supported here. That syntax is supported by `substituteTemplate()` in `packages/destinations/src/generic/template.ts` -- but that function is only called by destinations, not by workflows.

### Variables per workflow step

**`sprigly-prospect-research`**

Built by `buildTemplateVars(input)` at `sprigly-prospect-research.ts:241`:

| Variable | Source |
|---|---|
| `{{brandName}}` | `input.brandName` |
| `{{url}}` | `input.url` (empty string if absent) |
| `{{sector}}` | `input.sector` (empty string if absent) |
| `{{meetingDate}}` | `input.meetingDate` (empty string if absent) |
| `{{whyInterested}}` | `input.whyInterested` (empty string if absent) |
| `{{notes}}` | `input.notes` (empty string if absent) |
| `{{today}}` | UTC date at run time, formatted `DD Mon YYYY` (e.g. `19 May 2026`) |

All variables are available in both the research step and the write step. The prompts decide which ones to use.

**`sprigly-blog-post`**

| Step | Variables available |
|---|---|
| research | `{{topic}}` |
| structure | `{{topic}}`, `{{research}}` (JSON string of the research step output) |
| write | `{{topic}}`, `{{research}}` (JSON string), `{{title}}` (from structure step), `{{keyword}}` (from research step) |

**`sprigly-meeting-prep`**

| Variable | Source |
|---|---|
| `{{topic}}` | `input.topic` |
| `{{notes}}` | `input.notes` (empty string if absent) |

---

## Versioning

Versions are integers, starting at 1. Each edit creates a new row rather than updating in place. The resolver always reads the highest version for a given `(client_id, workflow_id, step_name)`.

Old versions are never deleted. They remain in the table and are queryable via the admin UI. Rollback means manually inserting a new row with the old text (which gets the next version number). There is no one-click rollback.

The admin UI `saveNewVersion()` action (`apps/web/src/app/admin/prompts/actions.ts:8`) computes the next version by reading `MAX(version)` for the scope and incrementing by 1. It inserts a new row, then redirects to the new row's detail page.

---

## Global defaults vs client overrides

A row with `client_id = NULL` is the global default. It is the fallback for any client that does not have their own row.

A row with `client_id = <uuid>` is a client-specific override. It takes precedence over the global default when that client's workflow runs.

The admin UI allows creating client overrides. When you copy a global default for a client, the new row records `copied_from_template_id` and `copied_from_version`. This is purely informational -- the resolver does not use these fields. They exist so you can see how far the client's prompt has drifted from the global version.

---

## The `__PROMPT_NOT_CUSTOMISED__` sentinel

The migration that seeds the `sprigly-meeting-prep` global default (`packages/db/migrations/0006_sprigly_meeting_prep_prompts.sql`) inserts placeholder text:

```
__PROMPT_NOT_CUSTOMISED__

TODO: Replace with the actual generate prompt for sprigly-meeting-prep.

Input variables available:
  {{topic}}   -- the primary value from the email subject line
  {{notes}}   -- optional notes from the email body
```

`sprigly-meeting-prep.ts` checks for this sentinel before running:

```typescript
if (prompt.includes('__PROMPT_NOT_CUSTOMISED__')) {
  throw new Error(
    'Prompt template for sprigly-meeting-prep step "generate" has not been customised...'
  );
}
```

No other workflow has this guard. The pattern exists because `sprigly-meeting-prep` is a scaffolded skeleton -- not registered with the worker -- and the guard prevents it from silently producing garbage output if someone registers it before writing a real prompt.

---

## How to add a prompt step to a new workflow

This is covered in the workflow authoring checklist in `workflows/adding-a-workflow.md`. The short version:

1. Decide on a `stepName` string (e.g. `'analyse'`). This is what you pass to `ctx.prompts.resolve()`.
2. Write the prompt text. Document which `{{variables}}` it uses.
3. Create a migration in `packages/db/migrations/` that inserts the global default row (`client_id = NULL`).
4. Call `ctx.prompts.resolve(ctx.clientId, 'your-workflow-id', 'analyse')` in the workflow's `run()`.
5. Call `fillTemplate(prompt, { ...vars })` with the variables the prompt expects.

The migration is not optional. Without a global default row, every run of the workflow throws `No prompt template found`.

---

## Gotchas

**Missing prompt throws, not returns empty.** There is no graceful degradation. If you deploy a new workflow step without inserting a matching `prompt_templates` row, every run fails immediately.

**`fillTemplate` silently drops unknown variables.** If the prompt contains `{{unknownVar}}` and you do not pass `unknownVar` in the vars object, it renders as an empty string. There is no warning. Review the prompt text against the vars object when debugging unexpected model output.

**Global default is not re-read after client override is deleted.** The resolver reads client-specific first, then global. There is no "delete override and fall back" UI action. Deleting a client-override row from the database directly would restore the global default on the next run.

**No prompt preview before running.** The admin UI shows the raw text with `{{variables}}` unsubstituted. You cannot see what the model will actually receive without running the workflow.

**Version numbers are per scope, not global.** A global default at version 5 and a client override at version 2 are unrelated sequences. The resolver reads whichever is highest for its scope.

---

## Cross-references

- `workflows/anatomy.md` (how `ctx.prompts.resolve()` fits into the step pattern)
- `reference/database-schema.md` (`prompt_templates` table)
- `operations/monitoring.md` (admin UI prompts page)
- `workflows/adding-a-workflow.md` (checklist for writing and seeding a new prompt)
