/**
 * parse-plan.ts — tolerant parsing of the planning model's JSON output.
 *
 * Dependency-free (only a type import) so it is unit-testable without the worker's
 * DB/Drive/model graph. The plan JSON is the platform's largest output (~10k+
 * tokens, 25 posts); a single stray char occasionally makes it unparseable. A
 * strict parse runs first; on failure ONE light repair pass (trailing commas,
 * stray control chars — the common recoverable malformations) is tried before
 * giving up. It throws only on genuinely unparseable output, so the caller in
 * planning.ts re-asks the model once and the cycle still fails loudly on a real
 * problem rather than shipping a malformed plan.
 */
import type { PlanPostRow } from './plan-validation.js';

export function parsePlanResponse(text: string): PlanPostRow[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  // If still wrapped in prose, slice to the outermost JSON object.
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start !== -1 && end > start) raw = raw.slice(start, end + 1);
  }
  const extractPosts = (parsed: unknown): PlanPostRow[] => {
    const posts = Array.isArray(parsed) ? parsed : (parsed as { posts?: unknown }).posts;
    if (!Array.isArray(posts) || posts.length === 0) {
      throw new Error('planning: model response had no "posts" array');
    }
    return posts as PlanPostRow[];
  };
  try {
    return extractPosts(JSON.parse(raw));
  } catch (firstErr) {
    // Light, safe repair: drop trailing commas before } or ], and strip stray
    // control characters (keeping \t \n \r). These are the malformations a single
    // stray char produces; the repair never changes well-formed JSON's meaning.
    const repaired = raw
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (repaired !== raw) {
      try { return extractPosts(JSON.parse(repaired)); } catch { /* fall through to throw */ }
    }
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
  }
}
