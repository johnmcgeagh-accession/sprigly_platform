/**
 * terminology.fence.test.ts — the words the client never sees.
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
 *   "APPROVE"  the mobile flow has no approval step and must not imply one. Proposals were an
 *              internal staging concept with a desktop review view; on a phone the sentence
 *              "1 change to approve" pointed at a screen the client could not open, and the
 *              change sat there unapplied. The client now reads an INTERPRETATION and taps
 *              Apply. "Approve" is also the wrong word on its own terms — you approve somebody
 *              else's work before they proceed, and this is the client's own plan.
 *
 * The check is a grep the standing invariant already asks for on every session, made permanent.
 * It scans the STRINGS a client could read: quoted literals, template-literal text, and JSX
 * text nodes. Identifiers, prop names, test ids and comments are not client-facing and are
 * excluded explicitly rather than by accident.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every component a client can reach: the plan surfaces, plus the draft shell above them —
 * and the LIB THAT WRITES THEIR WORDS.
 *
 * Scanning components alone left a growing share of this surface's sentences outside the grep.
 * `draft-rationale.ts` composes the beat sheet's grounding lines and every row of the month
 * summary; `draft-mutations.ts` owns the messages the client is flashed when a write refuses;
 * `plan.ts` supplies the last-resort card heading. None of that is copy in a component, and all
 * of it is copy on a screen. Widening the root found two live violations that had survived every
 * previous run precisely because they were out of reach.
 */
const ROOTS = [
  join(process.cwd(), 'src', 'components', 'plan'),
  join(process.cwd(), 'src', 'components', 'DraftPlan.tsx'),
  join(process.cwd(), 'src', 'components', 'PlanApp.tsx'),
  join(process.cwd(), 'src', 'lib'),
];

/**
 * Files inside the roots that carry the VOCABULARY but never the COPY. Each entry is a
 * justification, not an exemption — the same rule the tokens fence's nowrap list follows.
 *
 *   queue.ts / agent/*   'failed' is a BullMQ job state and a discriminant on a result union.
 *                        Neither is ever rendered; both are the words the platform itself uses,
 *                        and renaming them would rename a real concept to satisfy a copy rule.
 *   e2e-fake.ts          A fixture, hard-gated behind SPRIGLY_E2E_FAKE=1 AND non-production, so
 *                        it cannot reach a client at all. Its "BEAT 1 (0–5s)" is a video
 *                        script's own vocabulary — a shot — and not our word for a slot.
 *
 * Scoped to whole files deliberately. A path list is auditable in one read; a value list would
 * quietly grow into a way of keeping a banned word by naming it.
 */
const NOT_COPY = new Set([
  'src/lib/queue.ts',
  'src/lib/agent/proposals.ts',
  'src/lib/agent/types.ts',
  'src/lib/e2e-fake.ts',
]);

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
const BANNED_BARE = /^(?:beats?|retry|retried|retrying|failed|failure|approve|approved|approval|approvals)$/i;
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
    if (NOT_COPY.has(relative(process.cwd(), f))) continue;
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

  it('reaches the lib that writes the copy, not just the components that render it', () => {
    for (const rel of ['src/lib/draft-rationale.ts', 'src/lib/draft-mutations.ts', 'src/lib/plan.ts']) {
      expect(FILES.some((f) => relative(process.cwd(), f) === rel), rel).toBe(true);
    }
  });

  it('every justified exemption names a file that is really in the scan', () => {
    // A stale path exempts nothing and reads as though it does. If one of these moves, this
    // fails and someone has to decide again whether the justification still holds.
    for (const rel of NOT_COPY) {
      expect(FILES.some((f) => relative(process.cwd(), f) === rel), rel).toBe(true);
    }
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

  /**
   * ── "approve" is fenced out of the VOICE FLOW ─────────────────────────────────────
   *
   * Scoped, not global, and the scope is the point. The DESKTOP surface (`PlanDesktop`,
   * `ExtractionSummary`, `ApprovalRail`) genuinely has an approval step, built around a review
   * queue, and its copy is correct for what it does — renaming that would be renaming a real
   * concept to satisfy a rule about a different surface.
   *
   * What must never say it is the flow a phone actually walks: the voice sheet, the
   * interpretation, and the shells that host them. There, consent happens once, in place, on the
   * thing being consented to, and the confirm says what it does.
   */
  const VOICE_FLOW = [
    'src/components/plan/surface/VoiceSheet.tsx',
    'src/components/plan/surface/Interpretation.tsx',
    'src/components/plan/surface/AgentVoice.tsx',
    'src/components/plan/surface/Feedback.tsx',
    'src/components/plan/surface/CommittedSurface.tsx',
    'src/components/plan/surface/DraftSurface.tsx',
  ];

  it('the voice flow reads a real set of files (a fence over nothing is not a fence)', () => {
    for (const rel of VOICE_FLOW) {
      expect(FILES.some((f) => relative(process.cwd(), f) === rel), rel).toBe(true);
    }
  });

  it('never says "approve" or "approval" anywhere a phone can reach', () => {
    const hits: string[] = [];
    for (const rel of VOICE_FLOW) {
      const f = FILES.find((x) => relative(process.cwd(), x) === rel);
      if (!f) continue;
      for (const s of clientStrings(readFileSync(f, 'utf8'))) {
        if (/\bapprov(e|ed|es|ing|al|als)\b/i.test(s)) hits.push(`${rel}: "${s.slice(0, 90)}"`);
      }
    }
    expect(hits, `consent happens in place and the confirm says Apply —\n${hits.join('\n')}`).toEqual([]);
  });
});
