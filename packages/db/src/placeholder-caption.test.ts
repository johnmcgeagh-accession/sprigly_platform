/**
 * placeholder-caption.test.ts — a column that is not empty and content that does not exist.
 *
 * `addDraft` writes `DRAFT_PLACEHOLDER_CAPTION` into the caption column of every subject-less
 * add. It is scaffolding: it tells the client what to do next, and it is not a caption. Anything
 * asking `!post.caption` gets the wrong answer, and two things that spend money did —
 * `/api/plan/script` and the script worker both accepted it as the subject to build a reel's hook
 * and script around, which is what the operator hit on a fresh reel.
 *
 * This predicate lives in the package the app and the worker both already import, so there is one
 * answer to the question rather than one per caller.
 */
import { describe, it, expect } from 'vitest';
import { hasRealCaption, DRAFT_PLACEHOLDER_CAPTION, DRAFT_PLACEHOLDER_PREFIX } from './schema.js';

describe('hasRealCaption', () => {
  it('reads the placeholder as ABSENT, which is the whole point', () => {
    expect(hasRealCaption(DRAFT_PLACEHOLDER_CAPTION)).toBe(false);
  });

  it('matches on the PREFIX, so an edited tail does not smuggle it back in', () => {
    expect(hasRealCaption(`${DRAFT_PLACEHOLDER_PREFIX} something slightly different.`)).toBe(false);
    // …and the prefix really is a prefix of the full sentence, so the two cannot disagree.
    expect(DRAFT_PLACEHOLDER_CAPTION.startsWith(DRAFT_PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('reads an empty or whitespace caption as absent', () => {
    expect(hasRealCaption('')).toBe(false);
    expect(hasRealCaption('   \n ')).toBe(false);
    expect(hasRealCaption(null)).toBe(false);
    expect(hasRealCaption(undefined)).toBe(false);
  });

  it('reads a real caption as present, including one that merely mentions a draft', () => {
    expect(hasRealCaption('Wilderness is back.')).toBe(true);
    // Only the scaffolding sentence is scaffolding. A client writing about their own drafts is
    // writing a caption.
    expect(hasRealCaption('Draft ideas, and the ones that made it.')).toBe(true);
  });

  it('tolerates the leading whitespace a paste can bring', () => {
    expect(hasRealCaption(`  ${DRAFT_PLACEHOLDER_CAPTION}`)).toBe(false);
    expect(hasRealCaption('  Wilderness is back.')).toBe(true);
  });
});
