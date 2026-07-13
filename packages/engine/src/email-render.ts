/**
 * email-render.ts — the ONE renderer for intake-capture email templates. Pure, no DB, no IO.
 * Lives in @sprigly/engine so BOTH the worker (email-send) and the admin template editor
 * (preview + merge-field list) render + validate identically — the field list can't drift.
 *
 * Semantics:
 *   - `{{field}}` where field is a KNOWN merge field → replaced with merge[field], or blank
 *     when the caller supplied no value (known-but-empty is legitimate: e.g. leanLine).
 *   - `{{field}}` where field is NOT known → THROW (fail-loud). A typo in a template must
 *     surface at render/validate time, not silently blank.
 */

/** Every merge field a template may reference, with a one-line description (the admin editor
 *  sources its field list from here so the two can't drift). Unknown fields fail-loud. */
export const MERGE_FIELDS = {
  contactName:    'The channel contact’s first name (falls back to “there”).',
  clientName:     'The client / brand name.',
  monthLabel:     'The plan month, e.g. “August 2026”.',
  cutoffDate:     'The cutoff date in the current month, e.g. “20 June”.',
  daysToCutoff:   'Whole days from today until the cutoff.',
  intakeLink:     'The client’s app link that opens the intake capture form.',
  appLink:        'The client’s plan app link (plan-ready notification).',
  questionsBlock: 'The numbered brief questions (base + this channel’s extras).',
  leanLine:       'The data-led opener paragraph (blank until the source is wired).',
  beatsSummary:   'A summary of the month’s dated beats (blank until wired).',
} as const;

export const KNOWN_MERGE_FIELDS = Object.keys(MERGE_FIELDS) as MergeField[];

export type MergeField = keyof typeof MERGE_FIELDS;
export type MergeData = Partial<Record<MergeField, string>>;

const KNOWN = new Set<string>(KNOWN_MERGE_FIELDS);
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** The unknown merge fields referenced by a template string, in first-seen order (for
 *  validation surfacing before publish). Empty ⇒ the template is valid. */
export function unknownMergeFields(...templates: string[]): string[] {
  const seen = new Set<string>();
  for (const t of templates) {
    let m: RegExpExecArray | null;
    PLACEHOLDER.lastIndex = 0;
    while ((m = PLACEHOLDER.exec(t)) !== null) {
      const name = m[1]!;
      if (!KNOWN.has(name)) seen.add(name);
    }
  }
  return [...seen];
}

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
