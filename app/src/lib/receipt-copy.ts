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

export interface EvergreenCopy {
  heading: string;
  body: string;
  /** Does "Add to this month" belong on this receipt? */
  rescue: boolean;
}

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
        rescue: false,
      };
    case 'couldnt_apply':
    case 'validation_failed':
      return {
        heading: 'We couldn’t apply this',
        body: `We couldn’t work this into ${monthName} automatically, so we’ve saved it to your ideas.`,
        rescue: true,
      };
    case 'not_applicable':
      return {
        heading: `Nothing changed in ${monthName}`,
        body: `We’ve saved this to your ideas.`,
        rescue: true,
      };
    case 'model_error':
      return {
        heading: 'We couldn’t read this just now',
        body: `Something went wrong on our side, so nothing in ${monthName} changed.`
          + ` It’s saved — try saying it again.`,
        rescue: false,
      };
    default:
      return {
        heading: 'Saved to your ideas',
        body: `We’ve kept this for later rather than changing ${monthName}. If you meant now, add it to this month.`,
        rescue: true,
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
    case 'validation_failed':  return 'We couldn’t apply that';
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
