/**
 * operations.ts — does a sentence act on a post that already exists?
 *
 * ITS OWN MODULE so the CLIENT can import it. `receipt-copy.ts` needs it to decide whether the
 * "Add to this month" tap is safe, and that file is imported by three client components. A root
 * `@sprigly/engine` import would pull the whole engine into the browser bundle — which is why
 * the two existing root imports in `app/src/components` are type-only with a comment saying so,
 * and the one runtime import uses a subpath. This is that subpath.
 */
/**
 * Does this sentence ask us to OPERATE ON A POST THAT ALREADY EXISTS?
 *
 * ── What it is for, and why it is not `isRequestForChange` ──────────────────────────
 *
 * A receipt cannot tell a misread from a correct filing — the classifier's verdict is the only
 * judgement of intent in the system and it is the thing that failed. But `isRequestForChange`
 * above already read the same sentence, deterministically, and its answer is thrown away. When
 * gate 3 calls something a REQUEST and the model calls it an IDEA, two independent readers
 * disagree, and that is the population where the doubt is worth saying out loud.
 *
 * This is deliberately NARROWER than `ACTION_VERB`. It carries only the verbs that act on
 * something already on the calendar — move it, drop it, swap it — and not the additive ones
 * (add, create, write), because an undated ADDITION filed as an idea is CORRECT: CLASSIFY_SYSTEM
 * says so in as many words, and the backlog rescue then does exactly the right thing with it.
 * Measured on the scope-eval corpus: of the 20 inputs genuinely expected evergreen, ZERO name an
 * operation, while both reported misreads do. Widening it to the full verb list picks up three
 * of the twenty — two brand-voice statements carrying "make"/"bring" and one "could be nice".
 *
 * ── It also decides whether the rescue tap is offered ───────────────────────────────
 *
 * Not only the wording. `addBacklogItemToMonth` re-routes a filed row as `kind: 'event'` with
 * the first 80 characters as its SUBJECT, and displaces the weakest beat to make room. On a
 * misread instruction that means a post titled *"can you move one of the posts to the next
 * available empty day?"* pushing a real September post out of the month. The one affordance
 * offered on that receipt is actively destructive, so the same predicate that hedges the copy
 * withdraws the button.
 *
 * The modal register is deliberately not consulted. "Could we do a founder story sometime" is a
 * request by register and an idea by content; the verb is what says which.
 */
export function namesAnOperation(text: string): boolean {
  return /\b(move|swap|switch|push|pull|delete|remove|drop|shift|reschedule|replace|postpone|cancel|change|turn|edit|update|fix)\b/i
    .test(text);
}
