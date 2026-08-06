/**
 * receipt-copy.ts — what a receipt SAYS, in one place, for every surface that says it.
 *
 * ── The failure, twice ──────────────────────────────────────────────────────────────
 *
 * Six reasons reach an evergreen receipt and five of them rendered the same sentence — "Saved to
 * your ideas", the copy for a filing the client ASKED FOR. That was fixed by giving each family
 * its own words and putting the rule in one function. Three emitters read it. TWO DID NOT, and
 * the very next draft-surface session showed both at once:
 *
 *   "Saved to your ideas — nothing on the month changed.Saved as an idea — not a change to
 *    September"
 *
 * The first sentence is the THREAD turn, built in `DraftSurface`'s submit handler from `scope`
 * alone — it never looked at `reason`, so it could not know which family it was narrating. The
 * second is the panel heading, which did. Both were on screen.
 *
 * It prefixed FIVE of the six families. Four now contradict the panel outright; one
 * (`classified_evergreen`) was doubled but agreed, which is why it survived unnoticed until a
 * family said something different; and `not_applicable` escaped only because the handler checks
 * `note` before falling through, not because anything checked the family.
 *
 * ── So the rule moved OUT of the component folder ───────────────────────────────────
 *
 * It used to live in `components/plan/surface/receipt-summary.ts`, which a server route cannot
 * reasonably import — and that is exactly why `apply/route.ts` had grown its own hardcoded copy
 * of the generic sentence, written into the stored conversation where it outlives the session.
 * A shared rule that half the readers cannot reach is a rule that will be re-implemented.
 *
 * Five emitters, one definition:
 *
 *   the thread turn        `threadMessage`  — DraftSurface, both submit handlers
 *   the stored transcript  `threadMessage`  — apply/route.ts
 *   the panel heading      `evergreenCopy`  — ReceiptPanel, DraftPlanView
 *   the panel body         `evergreenCopy`  — ReceiptPanel, DraftPlanView
 *   the summary chip       `evergreenChip`  — receipt-summary.ts
 *
 * Pure. No React, no db, no types from either — `threadMessage` is structural on the four fields
 * it reads, so a client component and an API route can both call it without importing the other's
 * world.
 */

// The subpath, not the root: this module is imported by three CLIENT components, and a root
// `@sprigly/engine` import would pull the whole engine into the browser bundle.
import { namesAnOperation } from '@sprigly/engine/operations';

export interface EvergreenCopy {
  heading: string;
  body: string;
  /**
   * Does this FAMILY permit the rescue tap at all?
   *
   * Not the whole answer, and never call it directly — use `offersRescue`, which also asks the
   * SENTENCE. A family may veto (`model_error`: retrying is the right move, not promoting), but
   * it can never grant, because the hazard is not a property of the family.
   */
  familyRescue: boolean;
}

/**
 * EVERY REASON THAT CAN REACH A RECEIPT. Exported so the exhaustiveness test can walk it.
 *
 * Five come from `EvergreenReason` in intake-classify; `not_applicable`, `unclear` and
 * `read_as_idea` are added by draft-apply. Two of these have now fallen through to the wrong copy
 * in production — `ambiguous` silently since the families were introduced, and `unclear` while it
 * was still folded into `not_applicable` — because the map is a switch with a default and an
 * unlisted reason RENDERS rather than failing. The set is small, closed and typed; the test walks
 * this list and asserts each one hits an explicit case.
 */
export const RECEIPT_REASONS = [
  'classified_evergreen', 'ambiguous', 'validation_failed', 'couldnt_apply', 'model_error',
  'not_applicable', 'unclear', 'read_as_idea',
] as const;
export type ReceiptReason = (typeof RECEIPT_REASONS)[number];

/**
 * ── THE FAMILIES ────────────────────────────────────────────────────────────────────
 *
 * `read_as_idea`      the model called it a standing idea AND the sentence names an operation on
 *                     a post that already exists. Cannot be proven a misread — the classifier is
 *                     the only reader of intent and it is what failed — so the copy STATES what
 *                     happened rather than asking "was that right?", which would be answered
 *                     through the classifier that just missed. NO RESCUE: promoting it would
 *                     title a post with the instruction and evict a real one.
 * `couldnt_apply`     the classifier threw twice. A system failure; say so.
 * `validation_failed` the model's output did not fit its schema. Also a system failure.
 * `not_applicable`    THE TRANSFORM RAN AND PRODUCED NOTHING, WHICH IS OFTEN CORRECT — the
 *                     cadence branch returns no ops with "Recorded 7 posts a week as your floor.
 *                     You have 9 posts this month", a complete success. Its own family for that
 *                     reason; the heading states the one thing true of every shape and the note
 *                     carries the rest.
 * `model_error`       Bedrock was unreachable. The only failure where saying the same words again
 *                     will probably just work. The row IS filed — `saveToBacklog` runs for every
 *                     evergreen reason — so "it's saved" is a fact, not reassurance.
 * anything else       a real filing the client asked for. Unchanged, and it is the common case.
 */
export function evergreenCopy(reason: string | undefined, monthName: string): EvergreenCopy {
  switch (reason) {
    case 'read_as_idea':
      return {
        heading: `Saved as an idea — not a change to ${monthName}`,
        body: `This read as something for later, so nothing in ${monthName} changed.`
          + ` If you meant it now, tell me which post and which date — like “move the 21st to the 30th”.`,
        familyRescue: false,
      };
    // FOUR WAYS OF NOT UNDERSTANDING, one sentence. `ambiguous` is here because it means the
    // model's intent failed validation — we could not establish what was wanted — which is the
    // same event as the other three from the client's side. It had been falling to the default
    // and reading as a filing they asked for.
    case 'couldnt_apply':
    case 'validation_failed':
    case 'ambiguous':
    case 'unclear':
      return {
        heading: 'We couldn’t apply this',
        body: `We couldn’t work this into ${monthName} automatically, so we’ve saved it to your ideas.`,
        familyRescue: true,
      };
    // UNDERSTOOD, AND THERE WAS NOTHING TO DO. Only that, now `unclear` has been split out of it:
    // a cadence floor already met, an emphasis the month already satisfies, a series whose every
    // date falls next month, no room left to displace anything.
    case 'not_applicable':
      return {
        heading: `Nothing changed in ${monthName}`,
        body: `We’ve saved this to your ideas.`,
        familyRescue: true,
      };
    case 'model_error':
      return {
        heading: 'We couldn’t read this just now',
        body: `Something went wrong on our side, so nothing in ${monthName} changed.`
          + ` It’s saved — try saying it again.`,
        familyRescue: false,
      };
    default:
      return {
        heading: 'Saved to your ideas',
        body: `We’ve kept this for later rather than changing ${monthName}. If you meant now, add it to this month.`,
        familyRescue: true,
      };
  }
}

/**
 * The same families in the CHIP's register, which is deliberately not the panel's.
 *
 * The panel heading sits directly above the client's quoted sentence, so it says "this"; the chip
 * is a label on a collapsed strip with the sentence nowhere in sight, so it says "that". The
 * pre-existing pair had that right and a single shared string would have flattened it. The month
 * is not in scope on a chip either, which is the second reason these are written out.
 *
 * What must never diverge is WHICH FAMILY a reason belongs to — a case here without one above is
 * the drift that matters, and the tests pin the two together.
 */
export function evergreenChip(reason: string | undefined): string {
  switch (reason) {
    case 'read_as_idea':       return 'Saved as an idea — not a change';
    case 'not_applicable':     return 'Nothing needed changing';
    case 'model_error':        return 'We couldn’t read that';
    case 'couldnt_apply':
    case 'validation_failed':
    case 'ambiguous':
    case 'unclear':            return 'We couldn’t apply that';
    case 'classified_evergreen':
    default:                   return 'Saved to your ideas';
  }
}

/** The minimum `threadMessage` reads. Structural so a client component and an API route can both
 *  call it without importing `DraftApplication` (and its database world) or `DraftReceipt`. */
export interface ReceiptLike {
  scope:  string;
  reason?: string | undefined;
  lines?:  readonly string[] | undefined;
  note?:   string | undefined;
}

/**
 * THE AGENT'S TURN IN THE THREAD — the one surface that is always seen.
 *
 * It does NOT go silent when a receipt follows, and that is the decision worth stating. The
 * receipt panel lives behind a chip the client may never open; the thread holds the sentence they
 * just typed, and a turn with no reply reads worse than a redundant one. So the thread is the
 * PRIMARY carrier of the family copy and the panel is its expandable detail — which is why this
 * returns the family's `body` rather than its `heading`. A thread turn is a sentence.
 *
 * ── The order is load-bearing, and `not_applicable` is why ──────────────────────────
 *
 * `note` is preferred over the family body, exactly as it was before. A transform's own note is
 * strictly more specific than any family sentence — "Recorded 7 posts a week as your floor. You
 * have 9 posts this month" tells the client something the family cannot — and it already agrees
 * with that family's heading. So `not_applicable` is the ONE family whose thread turn does not
 * change, and the four that contradicted the panel are the four with no note to prefer.
 */
export function threadMessage(app: ReceiptLike | null | undefined, monthName: string): string {
  if (!app) return 'Done — the month view shows what changed.';
  if (app.lines?.length) return app.lines.join('\n');
  if (app.note) return app.note;
  if (app.scope === 'evergreen') return evergreenCopy(app.reason, monthName).body;
  // A month-scoped application with NO diff lines is not "nothing happened": it is context kept
  // with the month's brief, and this is the sentence that says the calendar did not move.
  return 'Done — the month view shows what changed.';
}

/**
 * IS "ADD TO THIS MONTH" SAFE ON THIS RECEIPT?
 *
 * ── Why this is not a property of the family ────────────────────────────────────────
 *
 * It was, and that was wrong. `read_as_idea` withheld the tap because promoting a misread
 * instruction is destructive, and every other family offered it — so the SAME hazard shipped
 * under a different reason. Live: "move one of the posts from the 18th September to the next
 * empty day" resolved its subject, failed on the date, landed on a zero-op reason, and was
 * offered the button.
 *
 * `addBacklogItemToMonth` re-routes the filed row as `kind: 'event'` with its first 80 characters
 * as the SUBJECT, and displaces the weakest beat to make room. On any operational sentence that
 * means a post titled with the client's instruction evicting a real one — and it does that
 * whatever reason put the text in the backlog. The hazard belongs to the SENTENCE.
 *
 * So the sentence decides, and a family may only ever VETO on top of it (`model_error`: saying
 * the same words again is the right move, not promoting them). Never call `familyRescue` alone.
 */
export function offersRescue(receipt: ReceiptLike & { sourceText?: string }, ): boolean {
  if (!evergreenCopy(receipt.reason, '').familyRescue) return false;
  return !namesAnOperation(receipt.sourceText ?? '');
}
