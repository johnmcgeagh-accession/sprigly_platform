/**
 * terminology.fence.test.ts — two words the client never sees.
 *
 * Spec §7 and G4. Both rules are absolute, and both are the kind that decays quietly:
 *
 *   "BEAT"     is a good internal word — it names a slot with evidence attached and no content
 *              yet — and a bad client one, because a client has never heard it and the thing it
 *              names looks to them exactly like a post. Client-facing it is "planned post", or
 *              in a committed month simply a post.
 *   FAILURE    the redesign removes the client's retry affordance, so a client is never told a
 *              generation failed. That is only honest because the sweep and the operator list
 *              exist (gap 7) — but the copy rule is what a reader sees, so it is fenced here.
 *
 * The check is a grep the standing invariant already asks for on every session, made permanent.
 * It scans the STRINGS a client could read: quoted literals, template-literal text, and JSX
 * text nodes. Identifiers, prop names, test ids and comments are not client-facing and are
 * excluded explicitly rather than by accident.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Every component a client can reach: the plan surfaces, plus the draft shell above them. */
const ROOTS = [
  join(process.cwd(), 'src', 'components', 'plan'),
  join(process.cwd(), 'src', 'components', 'DraftPlan.tsx'),
  join(process.cwd(), 'src', 'components', 'PlanApp.tsx'),
];

function sources(target: string, out: string[] = []): string[] {
  if (statSync(target).isFile()) { out.push(target); return out; }
  for (const name of readdirSync(target)) {
    const p = join(target, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => sources(r));

/** Comments are notes to us, not copy. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/**
 * Kebab, snake and camelCase tokens are identifiers, not sentences: `beat-marker` is an id,
 * `Beat removed` is copy, and `Beat` — one word, leading capital — is copy too.
 *
 * The one hole that leaves is a bare lower-case `beat` rendered as visible text, which reads as
 * camelCase to this rule. So a token that IS one of the banned words is never excused as an
 * identifier: the fence would rather examine a variable name than miss a word on the screen.
 */
const IDENTIFIER = /^(?:[a-z][a-zA-Z0-9]*|[a-z0-9]+(?:[-_][a-z0-9]+)+)$/;
const BANNED_BARE = /^(?:beats?|retry|retried|retrying|failed|failure)$/i;
const isCopy = (v: string) => !!v && (!IDENTIFIER.test(v) || BANNED_BARE.test(v));

/** `${…}` holes are code, not copy. Removed first (one level of nesting is enough for this
 *  codebase) so a template literal cannot smuggle an expression into the scan. */
const stripHoles = (s: string) => s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');

function clientStrings(src: string): string[] {
  const out: string[] = [];

  for (const raw of stripComments(src).split('\n')) {
    // Test ids, class names and React keys never reach a reader.
    const line = stripHoles(raw)
      .replace(/data-[a-z-]+=\{?["'`][^"'`]*["'`]\}?/g, ' ')
      .replace(/\bkey=\{[^}]*\}/g, ' ')
      .replace(/\bclassName=\{?["'`][^"'`]*["'`]\}?/g, ' ');

    for (const m of line.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      const v = m[1]!.trim();
      if (isCopy(v)) out.push(v);
    }
    // JSX text between tags.
    for (const m of line.matchAll(/>([^<>{}"'`]{2,})</g)) {
      const text = m[1]!.trim();
      if (isCopy(text)) out.push(text);
    }
  }
  return out;
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const f of FILES) {
    for (const s of clientStrings(readFileSync(f, 'utf8'))) {
      if (pattern.test(s)) hits.push(`${relative(process.cwd(), f)}: "${s.slice(0, 90)}"`);
    }
  }
  return hits;
}

describe('the terminology fence', () => {
  it('reads a real set of client components', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(12);
  });

  it('extracts copy and not identifiers (the fence has to be able to tell them apart)', () => {
    const sample = clientStrings(`<button data-testid="beat-marker" aria-label="Beat removed">Beat</button>`);
    expect(sample).toContain('Beat removed');
    expect(sample).toContain('Beat');
    expect(sample).not.toContain('beat-marker');
  });

  it('never says "beat" to a client', () => {
    const hits = offenders(/\bbeats?\b/i);
    expect(hits, `spec §7: "beat" is internal only —\n${hits.join('\n')}`).toEqual([]);
  });

  it('never reports a failure or asks for a retry', () => {
    // "try again" survives deliberately: it is what a network hiccup honestly says, and it is
    // not a report that a generation broke. What is banned is the vocabulary of OUR failure.
    const hits = offenders(/\b(retry|retried|retrying|failed|failure)\b/i);
    expect(hits, `spec G4: the client is never told a generation failed —\n${hits.join('\n')}`).toEqual([]);
  });
});
