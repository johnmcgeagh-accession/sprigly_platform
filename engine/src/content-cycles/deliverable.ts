/**
 * deliverable.ts — a deliverable contains the deliverable, and nothing else.
 *
 * The model reasons well; the pipeline was storing the reasoning. Reel scripts on uat carried
 * the full chain of thought — register deliberation, word-count arithmetic, "Actually
 * re-reading…" — with the actual script appended after a `---` marker (the round-two evidence).
 * script.ts stored `res.content.trim()` verbatim, so the client's script field WAS the
 * transcript.
 *
 * The fix is a contract plus a gate, both here so hook/script/combined share one implementation:
 *   1. the model is asked to put the finished deliverable AFTER a `===NAME===` marker, and we
 *      keep only what follows it — everything before (the thinking) is discarded;
 *   2. whatever survives is checked for deliberative markers, because a model that ignores the
 *      contract and reasons INSIDE the deliverable must not have that stored either.
 *
 * Pure. No db, no model — so both the extraction and the gate are testable against the exact
 * leaked shape without a Bedrock call.
 */

/** Matches a section header line: `===SCRIPT===`, `== HOOK ==`, etc. Whole-line, case-insensitive. */
function sectionHeader(name: string): RegExp {
  return new RegExp(`^[ \\t]*={2,}\\s*${name}\\s*={2,}[ \\t]*$`, 'im');
}
/** Any section header — used to bound one section against the next. */
const ANY_HEADER = '^[ \\t]*={2,}\\s*[A-Za-z][A-Za-z /]*\\s*={2,}[ \\t]*$';

/**
 * Extract the body of the `===NAME===` section: everything after its header up to the next
 * section header (or end). Returns null when the section is absent, so callers can fall back.
 */
export function extractSection(raw: string, name: string): string | null {
  const header = sectionHeader(name).exec(raw);
  if (!header) return null;
  const after = raw.slice(header.index + header[0].length);
  const next = new RegExp(ANY_HEADER, 'im').exec(after);
  const body = next ? after.slice(0, next.index) : after;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pull the deliverable out of a raw model response.
 *
 * Preference order, most-explicit first:
 *   1. the `===NAME===` section (the contract) — reasoning before it is discarded;
 *   2. the block after the LAST `---` rule (the shape the leak actually took on uat);
 *   3. the whole trimmed response (a clean, contract-free answer passes unchanged).
 */
export function extractDeliverable(raw: string, name: string): string {
  const section = extractSection(raw, name);
  if (section) return section;

  const parts = raw.split(/^[ \t]*-{3,}[ \t]*$/m);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1]!.trim();
    if (tail.length > 0) return tail;
  }
  return raw.trim();
}

/**
 * The reasoning-leak gate.
 *
 * Detects the fingerprints of chain-of-thought that has bled into a deliverable: word-count
 * arithmetic, "Actually re-reading…", "let me reconsider", "per the rules", and meta-references
 * to the model's own budget/register/instructions. Tuned for PRECISION — a false positive
 * withholds a good script — so each pattern targets a deliberative phrasing, not a bare word a
 * real script might use ("let me know in the comments" must pass; "let me re-read the brief"
 * must not).
 */
const DELIBERATIVE_MARKERS: readonly RegExp[] = [
  /\bactually,?\s+(re-?read|re-?reading|the|i\b|i'?m|let me|that|this|on second|scrap)/i,
  /\blet me\s+(re-?read|re-?count|recount|reconsider|rethink|check|count|think|make sure|ensure|adjust|revise|tighten|trim|see|try|rework|redo|fix)/i,
  /[~≈=]\s*\d+\s*words?\b/i,                                 // "≈66 words", "= 66 words"
  /\b\d+\s*words?\s*[-+×x*/=]\s*\d+/i,                       // "66 words - 8 = ..."
  /\bword\s*(count|budget|limit|target|allowance)\b/i,
  /\b(over|under|within|at)\s+(the\s+)?(budget|word\s*count|word\s*limit)\b/i,
  /\bper the (rule|rules|instruction|instructions|brief|spec|prompt)\b/i,
  /\bas instructed\b/i,
  /\b(the|my)\s+register\s+(is|should|shifts?|feels?|reads?|here|deliberation)/i,
  /\bchain[- ]of[- ]thought\b/i,
  /\bi(?:'ll| will| should| need to| must|'?ve)\s+(use|keep|treat|include|follow|leave)\b[^.\n]*\b(verbatim|as instructed|as-is|as is|the hook)\b/i,
  /\b(doesn'?t|does not|don'?t)\s+(match|fit|suit|align)\b[^.\n]*\b(arc|brief|pillar|hook)\b/i,
];

/** Does this text carry the fingerprints of leaked reasoning? */
export function hasDeliberativeMarkers(text: string): boolean {
  return DELIBERATIVE_MARKERS.some((re) => re.test(text));
}
