/**
 * applied-summary.ts — the chip label and the failure sentence for a background apply (F4).
 *
 * Pure, and derived from the SAME interpreted items the client consented to — never from a
 * sentence the model wrote. The chip compresses what LANDED into counts ('1 moved · 1 added');
 * the failure line names what did NOT, because "2 of 3 went through" without saying which two
 * leaves the client diffing their own month to find out.
 */
import type { InterpretedItem } from '@/lib/agent/types';

type Change = Extract<InterpretedItem, { kind: 'change' }>;

/** Verb counts for the chip: '1 moved · 2 added'. Empty string when nothing applied. */
export function appliedChipLabel(applied: readonly Change[]): string {
  if (!applied.length) return '';
  const PAST: Record<Change['action'], string> = {
    move: 'moved', add: 'added', remove: 'removed', rewrite: 'rewritten',
    format: 'reformatted', hook: 'hooks started', refine: 'refined',
  };
  const counts = new Map<string, number>();
  for (const c of applied) {
    const word = PAST[c.action] ?? 'changed';
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].map(([word, n]) => `${n} ${word}`).join(' · ');
}

/** One line naming a change, for the failure report: `Move "Title"`. */
function nameOf(c: Change): string {
  const VERB: Record<Change['action'], string> = {
    move: 'Move', add: 'Add', remove: 'Remove', rewrite: 'Rewrite',
    format: 'Reformat', hook: 'Generate hooks for', refine: 'Refine',
  };
  return `${VERB[c.action] ?? 'Change'}${c.title ? ` “${c.title}”` : ''}`;
}

/**
 * The single-channel failure sentence: what didn't apply, by name, and that it is still there.
 * Empty string when nothing failed.
 */
export function applyFailureMessage(failed: readonly Change[], appliedCount: number): string {
  if (!failed.length) return '';
  const names = failed.map(nameOf).join('; ');
  const head = appliedCount
    ? `${appliedCount} change${appliedCount === 1 ? '' : 's'} went through, but not ${failed.length === 1 ? 'this one' : 'these'}: ${names}.`
    : `That didn’t go through: ${names}.`;
  return `${head} ${failed.length === 1 ? 'It’s' : 'They’re'} still here to try again.`;
}
