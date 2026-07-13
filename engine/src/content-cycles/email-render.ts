/**
 * email-render.ts — the ONE renderer for intake-capture email templates. Pure, no DB, no IO.
 *
 * Semantics:
 *   - `{{field}}` where field is a KNOWN merge field → replaced with merge[field], or blank
 *     when the caller supplied no value (known-but-empty is legitimate: e.g. leanLine).
 *   - `{{field}}` where field is NOT known → THROW (fail-loud). A typo in a template must
 *     surface at render time, not silently blank.
 *
 * Kept deliberately separate from the send path (email-send.ts) so it is testable without
 * loading @sprigly/destinations / googleapis.
 */

/** Every merge field a template may reference. Unknown fields fail-loud. */
export const KNOWN_MERGE_FIELDS = [
  'contactName',
  'clientName',
  'monthLabel',
  'cutoffDate',
  'daysToCutoff',
  'intakeLink',
  'appLink',
  'questionsBlock',
  'leanLine',
  'beatsSummary',
] as const;

export type MergeField = typeof KNOWN_MERGE_FIELDS[number];
export type MergeData = Partial<Record<MergeField, string>>;

const KNOWN = new Set<string>(KNOWN_MERGE_FIELDS);
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Render one string. Throws on an unknown `{{field}}`; blanks a known field with no value. */
export function renderField(template: string, merge: MergeData): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!KNOWN.has(name)) {
      throw new Error(`email-render: unknown merge field {{${name}}} — not in KNOWN_MERGE_FIELDS`);
    }
    return merge[name as MergeField] ?? '';
  });
}

export interface RenderableTemplate { subjectTemplate: string; bodyTemplate: string }
export interface RenderedEmail { subject: string; body: string }

/** Render a template's subject + body against the merge data. Fail-loud on unknown fields. */
export function renderEmailTemplate(tpl: RenderableTemplate, merge: MergeData): RenderedEmail {
  return {
    subject: renderField(tpl.subjectTemplate, merge),
    body:    renderField(tpl.bodyTemplate, merge),
  };
}
