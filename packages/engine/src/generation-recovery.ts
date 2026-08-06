/**
 * generation-recovery.ts — what the system does about a caption that never got written.
 *
 * Spec gap 7. The mobile redesign removes the client's retry affordance, which is only
 * honest if the system recovers by itself and an operator sees what it cannot. That makes
 * three facts shared property rather than one module's business:
 *
 *   - the INSTRUCTION a re-generation runs with — the fan-out (app) and the sweep (worker)
 *     enqueue the same job, and two copies of a prompt is two prompts;
 *   - the BOUND on how many passes a post gets — the sweep enforces it, and the admin
 *     surface renders "will retry" vs "operator item" from the same number;
 *   - how to READ that count off a post, defensively, from jsonb nobody validates.
 *
 * All three live here so app, worker and admin cannot disagree about them. Pure — no db, no
 * queue, no React.
 */

/**
 * The one `beat_meta` shape this module reads.
 *
 * Structurally minimal ON PURPOSE: `BeatMeta` proper lives in the db package, and this file is
 * imported by both the app and the worker precisely because it depends on neither. Anything
 * wider than the two fields actually read would buy a dependency for nothing.
 */
import { launchArcSubject } from './draft-transforms.js';

export interface BeatSubjectSource {
  rationaleEvidence?: { basis?: string; reason?: string } | null;
}

/**
 * The basis whose `reason` is a SUBJECT rather than a preference.
 *
 * `client_input` is written by the four transforms that PLACE a beat from something the
 * client wrote — `applyLaunchArc`, `applySeries`, `applyCadence`, `applyEvent`. On those the
 * reason is what the post is about: "we're launching Molly on the 18th".
 *
 * The other two bases with a reason are deliberately excluded. `emphasis_reweight` carries a
 * PLANNING PREFERENCE — "can we do more reels this month" — which the placement has already
 * honoured; handing it to a caption writer as that post's subject is a category error, and on
 * ivy-t's September it would have briefed three beats with a sentence about format mix.
 * `client_added` carries no reason at all. `observed` and `template` are the assembler's own
 * reasoning about history, not the client's words.
 */
const SUBJECT_BASIS = 'client_input';

/**
 * The client's own sentence for a beat their instruction placed, or null.
 *
 * Defensive against jsonb nobody validates, in the same spirit as `sweepAttemptsOf`: a
 * malformed or absent beat_meta reads as "no subject" rather than throwing on the fan-out path.
 */
export function beatSubject(beatMeta: unknown): string | null {
  if (!beatMeta || typeof beatMeta !== 'object') return null;
  const ev = (beatMeta as BeatSubjectSource).rationaleEvidence;
  if (!ev || typeof ev !== 'object') return null;
  if (ev.basis !== SUBJECT_BASIS) return null;
  const reason = typeof ev.reason === 'string' ? ev.reason.replace(/\s+/g, ' ').trim() : '';
  return reason.length > 0 ? reason : null;
}

/** The caption instruction for a planned slot. `title` and `pillar` may be empty.
 *
 *  Deliberately spare. The beat already carries its date, format and pillar, and
 *  assembleShapeContext supplies voice, catalogue and competitor context. Restating those
 *  here would give the model two sources for the same facts and a chance to disagree with
 *  itself. The one thing it needs that the row does not carry is what this slot is FOR.
 *
 * ── `subject`: THE CLIENT'S OWN WORDS, AND WHY THEY ARE FRAMED THIS HARD ─────────────
 *
 * A beat placed by a client instruction stored that instruction in
 * `beat_meta.rationaleEvidence.reason` and nothing downstream ever read it. The month's
 * concrete facts — what is launching, what it is called, when — were held one table away from
 * the only thing that needed them, so "Molly — Launch" was written by a model that had a slot
 * title with no referent anywhere in its context. It reached for the one launch it COULD see,
 * in month-wide free notes, and introduced a different product.
 *
 * THE FRAMING IS THE LOAD-BEARING PART, because these sentences are not clean subject lines.
 * They are what a client actually types, and they carry ARC MECHANICS: "we need a launch post
 * and 2 teasers on the lead up", "can we have two tease posts prior to the launch post and a
 * follow up". That arrangement has ALREADY BEEN CARRIED OUT — it is why this beat exists, and
 * why it sits on this date with this title. Passed as a brief to satisfy, it invites a caption
 * that narrates the schedule ("we've got a launch and two teasers coming"), which is a post
 * about the plan instead of a post from it.
 *
 * So the block says three things, and each is doing work: those words are the SUBJECT; the
 * arrangement they ask for is already done and this post is one of its parts; and the schedule
 * is never the subject. What survives is exactly the useful residue — the name, the date, the
 * occasion.
 *
 * WHY IT HONOURS RATHER THAN DISCLAIMS, which is a correction to the obvious wording. The
 * first draft opened "as BACKGROUND and not as a brief to carry out". Printed through the real
 * assembly it lands inside `shape.ts`'s wrapper — `The client asked for this change: "…".
 * Rewrite the caption to honour it` — so the prompt told the model to honour a block that
 * described itself as not to be carried out. A contradiction the model has to resolve is a
 * contradiction it may resolve the wrong way. The wording now RESOLVES it instead: honouring
 * the instruction IS writing this post's share of the arrangement, which is both true and the
 * behaviour wanted. That is also why this is fixed here rather than by branching the wrapper —
 * see the note on `shape.ts` in the commit message.
 *
 * NOT TRUNCATED. `deriveTitle` exists because `subject` was unbounded prose and made unreadable
 * titles, and its docblock notes the FULL text is kept here so nothing is lost. Cutting the
 * client's brief mid-sentence on the way to the writer would re-open that in the one place the
 * whole text is the point.
 *
 * NOTE FOR ANY CHECK DOWNSTREAM: `detectInstructionLeak` does NOT cover this. It matches
 * bracketed placeholders (`[ITEM]`) and a fixed list of meta phrases ("leave blank", "see
 * notes"); a caption that fluently narrates a posting schedule contains neither and passes the
 * gate clean. Nothing mechanical catches it, which is why the prompt has to.
 */
export function captionInstruction(title: string, pillar: string, subject?: string | null): string {
  const brief = `Write the caption for this post. It is the "${title}" slot in this month's plan${pillar ? `, under the ${pillar} pillar` : ''}. Keep it to that subject.`;
  if (!subject) return brief;
  return [
    brief,
    '',
    "WHAT THIS POST IS ABOUT — the client's own words:",
    `"${subject}"`,
    'That is the SUBJECT: what is happening, what it is called, and when. Those words may also describe how the client wanted the month arranged (how many posts, which dates, teasers, follow-ups). That arrangement is ALREADY DONE — it is why this post exists, on this date, with this title — so honour it by writing THIS post\'s share of it and nothing else. The schedule is never the subject: do not mention the other posts, the running order, or the plan itself.',
  ].join('\n');
}

// ─── THE UNGROUNDABLE LAUNCH ──────────────────────────────────────────────────
//
// A launch post whose product is in no catalogue is the one beat that CANNOT be written
// honestly. Its whole job is to name the thing launching, and nothing in the pipeline can tell
// that the name is fiction: the code gate has no product logic, the critic is never given the
// catalogue, and `validateText` returns [] the moment no known name is hit — it validates
// PAIRINGS of names it already knows, so an absent name is invisible to it by construction.
//
// So it is caught BEFORE the spend, at enqueue, or not at all.

/** `source_meta` flag: this post was not sent to be written, because its subject is ungroundable.
 *  The FACT, kept separate from the copy for the reason `quotaBanked` is — a state anything has
 *  to act on must not be inferred from a sentence that will be reworded. */
export const UNGROUNDED_KEY = 'subjectUngrounded';

/** `source_meta`: the subject we could not ground ("Molly"), for the question the card asks. */
export const UNGROUNDED_SUBJECT_KEY = 'ungroundedSubject';

export function isSubjectUngrounded(sourceMeta: unknown): boolean {
  if (!sourceMeta || typeof sourceMeta !== 'object') return false;
  return (sourceMeta as Record<string, unknown>)[UNGROUNDED_KEY] === true;
}

export function ungroundedSubjectOf(sourceMeta: unknown): string | null {
  if (!sourceMeta || typeof sourceMeta !== 'object') return null;
  const v = (sourceMeta as Record<string, unknown>)[UNGROUNDED_SUBJECT_KEY];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * The subject of a launch beat that cannot be grounded, or null to let it generate.
 *
 * FOUR conditions, and every one of them is a reason NOT to decline. The default is to write
 * the post: this refuses to bill for a caption only when it can say precisely why.
 *
 *   1. IT IS A LAUNCH BEAT. Read off the arc suffix its own transform wrote. A beat that is not
 *      a launch is never declined, whatever it names — naming a product is not its purpose, and
 *      it can write around one. That is why September's back-to-school beat is out of scope
 *      even though "Karen" is uncatalogued too: it now carries the client's own sentence, and a
 *      back-to-school post does not have to name a product to be a good post.
 *   2. ITS SUBJECT CAME FROM THE CLIENT. `beatSubject` is `client_input`-only, which is exactly
 *      the set whose subject never met the catalogue. The assembler's own beats take their
 *      product FROM the catalogue (`assignCoverage` → `coverageTitle`), so they are grounded by
 *      construction and cannot be the thing this looks for.
 *   3. THERE IS A CATALOGUE TO BE ABSENT FROM. No catalogue is not evidence of absence. With no
 *      names to check against, every launch in the month would decline at once.
 *   4. THE SUBJECT NAMES NO FAMILY IN IT.
 *
 * ── WHY `catalogueNames` IS PASSED IN, AND WHY IT MUST NOT BE indexCatalogue's `names` ──
 *
 * `indexCatalogue` EXCLUDES ambiguous names — the client's own brand tokens — from `names`, so
 * that `validateText` cannot read the brand as a product. That exclusion is right for a
 * PRESENCE test and wrong for an ABSENCE test, and the two are not the same question:
 * ivy-t's catalogue really does have a family called "Ivy", and it is missing from that index BY
 * DESIGN. An absence check reusing it would conclude the brand's own name is uncatalogued.
 *
 * This takes the FULL family-name set, exclusions and all, from a reader that does no filtering
 * (`loadProductNames`). Passing it in rather than loading it keeps this pure, and keeps the one
 * decision that matters — which set of names counts as "the catalogue" — at the call site,
 * where the comment above it can be read.
 */
export function ungroundedLaunch(
  post: { title?: string | null; beatMeta?: unknown },
  catalogueNames: ReadonlySet<string>,
): string | null {
  const subject = launchArcSubject(post.title);
  if (!subject) return null;                          // 1
  if (!beatSubject(post.beatMeta)) return null;       // 2
  if (catalogueNames.size === 0) return null;         // 3
  const haystack = ` ${subject.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const name of catalogueNames) {
    const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (n.length > 0 && haystack.includes(` ${n} `)) return null;   // 4 — grounded
  }
  return subject;
}

/**
 * Passes the daily sweep will spend on one post before it becomes an operator item.
 *
 * Each pass is up to three paid Bedrock attempts (GENERATION_JOB_OPTIONS), so the ceiling is
 * nine — enough that an outage on the night of a fan-out self-heals by morning, and small
 * enough that a post whose brief the model genuinely cannot satisfy is not billed forever.
 */
export const MAX_SWEEP_ATTEMPTS = 2;

/** The source_meta key the count lives under. Named once so a typo cannot silently reset it. */
export const SWEEP_ATTEMPTS_KEY = 'generationSweepAttempts';

/** Read the sweep count off a post's source_meta. Absent, malformed or negative reads as 0. */
export function sweepAttemptsOf(sourceMeta: unknown): number {
  if (!sourceMeta || typeof sourceMeta !== 'object') return 0;
  const v = (sourceMeta as Record<string, unknown>)[SWEEP_ATTEMPTS_KEY];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

/** Has this post used every pass it is going to get? The predicate the sweep stops on and
 *  the admin list renders as "no further attempts — yours". */
export function sweepExhausted(sourceMeta: unknown): boolean {
  return sweepAttemptsOf(sourceMeta) >= MAX_SWEEP_ATTEMPTS;
}
