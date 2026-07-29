/**
 * format-change.ts — what a format change actually does to a hook and a script, said out loud.
 *
 * The phone-check ruling that reinstated the format control (P2) asked for the consequence to be
 * surfaced honestly: "they clear or regenerate — state which the existing machinery does and
 * follow it."
 *
 * **It does neither.** `patchPost` writes the `format` column and nothing else — the hook and
 * script rows are untouched, so a reel turned into a single post keeps a script that no longer
 * applies, and a single post turned into a reel has neither. Nothing is cleared and nothing is
 * regenerated. Clearing them would be a silent destruction of the client's words on a control
 * that says "format"; regenerating would spend money on a tap that did not ask for it.
 *
 * So the surface says what is true and offers the action on the tab that owns it (P3).
 *
 * Pure, and separate from the component, because the thing that rots is the sentence — a later
 * change to what the mutation does has to fail a test here rather than quietly making the copy a
 * lie. No React.
 */

/** Formats that carry an opening hook. */
const NEEDS_HOOK = new Set(['reel', 'carousel']);
/** Formats that carry a script. */
const NEEDS_SCRIPT = new Set(['reel']);

export const formatNeedsHook = (format: string): boolean => NEEDS_HOOK.has(format);
export const formatNeedsScript = (format: string): boolean => NEEDS_SCRIPT.has(format);

const WORD: Record<string, string> = { reel: 'a reel', carousel: 'a carousel', single: 'a single post' };
const word = (f: string): string => WORD[f] ?? 'this format';

/**
 * One or two sentences for the note under the format control, or '' when there is nothing worth
 * saying — which is the common case, and an empty note is better than a reassuring one.
 *
 * @param to     the format just chosen
 * @param has    what the post currently holds
 */
export function formatChangeNote(to: string, has: { hook: boolean; script: boolean }): string {
  const stranded: string[] = [];
  if (has.hook && !formatNeedsHook(to)) stranded.push('hook');
  if (has.script && !formatNeedsScript(to)) stranded.push('script');

  const missing: string[] = [];
  if (formatNeedsHook(to) && !has.hook) missing.push('hook');
  if (formatNeedsScript(to) && !has.script) missing.push('script');

  const parts: string[] = [];
  if (stranded.length) {
    // Never "we removed" — we did not. The words are still there and still theirs.
    parts.push(`Your ${list(stranded)} ${stranded.length === 1 ? 'is' : 'are'} still saved, but ${word(to)} doesn’t use ${stranded.length === 1 ? 'it' : 'them'}.`);
  }
  if (missing.length) {
    parts.push(`${cap(word(to))} needs ${aList(missing)} — write ${missing.length === 1 ? 'it' : 'them'} on the ${list(missing)} tab${missing.length === 1 ? '' : 's'}.`);
  }
  return parts.join(' ');
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]): string => (xs.length === 1 ? xs[0]! : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const aList = (xs: string[]): string => list(xs.map((x) => `a ${x}`));
