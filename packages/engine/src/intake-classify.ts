/**
 * intake-classify.ts — the ONE model call in the intake→reshape path.
 *
 * A client sends one sentence. This decides two things about it:
 *   AXIS 1 (existing, elsewhere): pre-cutoff vs post-cutoff — cycle lifecycle, not content.
 *   AXIS 2 (here): MONTH-SCOPED (act on this month's draft now) vs EVERGREEN (an idea for
 *   the backlog). And, when month-scoped, WHAT to do — as a structured intent.
 *
 * Everything downstream of this file is deterministic. The model extracts intent; named
 * transforms apply it; the diff is computed from row deltas. The model never edits the
 * plan and never narrates what changed.
 *
 * ── Why this is a separate call from extractStructuredBrief ──────────────────
 * The brief asked me not to add a second LLM call if the existing extractor could carry
 * both axes. It cannot, for three reasons:
 *   1. It runs over the ACCUMULATED intake (merged answers + freeNotes), so it cannot say
 *      which input caused which change — and the diff receipt has to be tied to the
 *      sentence that caused it.
 *   2. Its output is a month BRIEF (products / schedule / content_asks) — a description of
 *      the month, not a routing decision about one input.
 *   3. It runs AFTER the intake is persisted, whereas routing must be decided before we
 *      know whether to touch the month at all.
 * They also fail differently: a failed brief extraction loses beat display, a failed
 * classification must silently become backlog routing. Merging them would couple those.
 *
 * ── The asymmetry rule ───────────────────────────────────────────────────────
 * Ambiguity routes to EVERGREEN. Always. Backlog-when-they-meant-now costs one tap to
 * fix; plan-when-they-meant-someday is a confusing mutation of a month they were happy
 * with. The costs are not symmetric, so the default is not neutral.
 */
import { z } from 'zod';
// Engine-local contracts, matching brief-extract.ts — keeps @sprigly/engine free of
// @sprigly/model-client and pino deps. pino's Logger is structurally assignable.
import type { ModelClient, AuditLogger } from './types.js';
import { parseLastJsonObject } from './json-salvage.js';

interface Logger { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }

// ── The validated contract ────────────────────────────────────────────────────

/**
 * A length bound that SHORTENS rather than refuses.
 *
 * Every other bound in this schema is a rejection, and rejection is right for a value that
 * is matched, looked up or parsed: a shortened key is a wrong key. It is wrong for a phrase
 * whose only consumer degrades safely on a shorter one — there, refusing the whole input
 * over its last few characters throws away everything the model got right.
 *
 * The cut is at a WHITESPACE boundary. Slicing mid-word can manufacture a token the client
 * never typed, and one of those tokens ("photoshoot" → "photos") is read downstream as a
 * format instruction. A trailing partial word is dropped rather than kept.
 *
 * A single token longer than the bound leaves nothing behind, and that is the honest result:
 * the consumer's own empty-input branch says it could not tell what was meant, which beats
 * inventing a prefix of a word nobody said.
 */
const displayPhrase = (max: number) =>
  z.string().transform((s) => {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    // The cut already fell on whitespace — every word in it is whole, so keep them all.
    if (/\s/.test(s.charAt(max))) return cut.trimEnd();
    // It fell mid-word. Drop that partial token; `\S*$` always matches, so a value with no
    // whitespace at all correctly leaves nothing rather than a prefix of one long word.
    return cut.replace(/\S*$/, '').trimEnd();
  });

const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * What the client wants done to this month.
 *
 * `sourceText` is REQUIRED on every intent: the receipt has to be able to show the client
 * the words that caused the change, and a transform writes it into the new beat's
 * evidence. An intent that cannot point back at its cause is not traceable, and
 * traceability is the whole promise of this surface.
 */
/**
 * One post of an ENUMERATED series — the client listed the dates themselves.
 *
 * `subject` is per-instance because that is how clients actually write these: "every Friday
 * in August: 7th — Maggie t-shirt; 14th — Lily tee" is four different posts, not one post
 * repeated. Dropping the per-date subject would turn four planned products into four
 * identical beats, which is the same information loss as not supporting series at all.
 */
const seriesInstanceSchema = z.object({
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subject: z.string().min(1).max(200).nullable().optional(),
});

/**
 * A series stated as a RULE rather than a list — "one post every 3 weeks from early August".
 *
 * `count` and `until` are both optional and both bounds: expansion stops at whichever comes
 * first, and at the plan month's end regardless. Neither is required, because a client
 * saying "every 3 weeks" usually means "until I say otherwise" — the month boundary is the
 * honest default bound, not a guess at how long they meant.
 */
const recurrenceSchema = z.object({
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intervalDays: z.number().int().min(1).max(366),
  count:       z.number().int().min(1).max(60).nullable().optional(),
  until:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const monthScopedIntentSchema = z.object({
  kind:       z.enum(['launch', 'event', 'series', 'beat_spec', 'cadence', 'emphasis', 'beat_edit', 'correction']),
  subject:    z.string().min(1).max(200),
  sourceText: z.string().min(1),
  dateRange:  dateRangeSchema.nullable().optional(),
  /**
   * beat_spec only — the format the client named for this one post ("a reel on the 22nd").
   * Absent when they named a date and a title but no format; the transform fills it from the
   * month's commonest format then, rather than guessing.
   */
  format:     z.enum(['reel', 'carousel', 'single']).nullable().optional(),
  /**
   * cadence only — how many posts the client wants. At least one of the two is required (the
   * route rejects a cadence with neither). Both are FLOORS: the assembler tops the month up to
   * meet them and never removes to fall below them.
   */
  postsPerWeek:  z.number().int().min(1).max(14).nullable().optional(),
  postsPerMonth: z.number().int().min(1).max(62).nullable().optional(),
  /**
   * series only — the dates the client listed, in their order. Takes precedence over
   * `recurrence` when both are present: an enumerated date is something the client stated,
   * a computed one is something we inferred, and the stated thing wins.
   */
  instances:  z.array(seriesInstanceSchema).max(60).nullable().optional(),
  /** series only — the rule, when they gave a cadence instead of a list. */
  recurrence: recurrenceSchema.nullable().optional(),
  /**
   * beat_edit only: which beat, in the client's words ("the Friday reel").
   *
   * REJECTS rather than shortens, and must. `resolveBeatRef` scans it for a weekday, a
   * format word and a day number, and falls back to `title.includes(needle)` when it finds
   * none — so a shortened ref matches a DIFFERENT set of beats, sometimes a different single
   * one. This is a lookup key, and a shortened key is a wrong key, not a short one.
   */
  beatRef:    z.string().max(200).nullable().optional(),
  /** beat_edit only: what to do with it. */
  edit:       z.enum(['move', 'swap_format', 'drop']).nullable().optional(),
  /**
   * beat_edit only: the new format or the new date.
   *
   * REJECTS. It is compared for equality against 'reel'/'carousel'/'single' or read as an
   * ISO date — the longest legitimate value is 10 characters, so 64 is already six times
   * what any real value needs and shortening could only ever corrupt one.
   */
  editValue:  z.string().max(64).nullable().optional(),
  /**
   * emphasis only: the pillar or format to weight up.
   *
   * ── THE ONE FIELD THAT SHORTENS INSTEAD OF REFUSING ──────────────────────────────
   *
   * The model reads the back-to-school brief as an emphasis correctly, 10 times out of 10,
   * and then writes a 113–138 character phrase into a field capped at 120. Nine times in ten
   * that failed the schema, both attempts failed the same way (the retry re-rolls the same
   * distribution, it does not fix a systematic overrun), and a whole month-scoped input was
   * lost to the backlog as "Saved to your ideas" over four characters.
   *
   * It is the only one of these fields that can be shortened safely, because it is the only
   * one whose consumer fails safe: `resolveEmphasisTarget` requires an outright winner and
   * answers `ambiguous` or `none` otherwise, and both change nothing and say so. A shortened
   * emphasis can lose the match; it cannot silently land on the wrong beat.
   *
   * ── AND THE CUT IS AT A WORD BOUNDARY, WHICH IS NOT TIDINESS ─────────────────────
   *
   * A blind `.slice(0, 120)` of the real 124-character output ends
   * *"…tied to the new Karen range photos"* — and `photos` is a FORMAT word, so the month's
   * commonest phrase would have resolved to `format: single` and reformatted a third of the
   * month on a word the client never said. Measured, on the exact string the corpus produces
   * five times in ten. Cutting at whitespace gives *"…the new Karen range"*, which correctly
   * matches nothing.
   *
   * The bound is 200 — the same as `subject`, `beatRef` and `correctionOf`, so the schema
   * has one number for "a phrase in the owner's words" rather than four. At 200 the observed
   * outputs pass untouched and the truncation is a backstop rather than a routine step.
   */
  emphasis:   displayPhrase(200).nullable().optional(),
  /**
   * correction only: what the owner is correcting ABOUT, in their words — "the Meadow
   * candle launch". Matched against the beats already on the plan, so a correction acts on
   * what is there rather than adding something new.
   *
   * Distinct from beatRef, which points at ONE post by day/format/date. A correction names
   * a SUBJECT and may move a whole arc: "the Meadow launch is the 10th not the 1st" is
   * three beats, not one.
   *
   * REJECTS, and this is the one where shortening would be worst. `resolveBeatSubject`
   * requires EVERY significant word to appear in a beat, so dropping words WIDENS the match
   * — and `applyCorrection` then moves every beat it matched, keeping their spacing. A
   * shortened correctionOf is a silent multi-beat reschedule, not a near miss.
   */
  correctionOf: z.string().max(200).nullable().optional(),
});

export type MonthScopedIntent = z.infer<typeof monthScopedIntentSchema>;

const classificationSchema = z.object({
  scope:  z.enum(['month_scoped', 'evergreen']),
  intent: monthScopedIntentSchema.nullable().optional(),
});

export type IntakeRouting =
  | { scope: 'month_scoped'; intent: MonthScopedIntent; sourceText: string }
  | { scope: 'evergreen'; sourceText: string; reason: EvergreenReason }
  /**
   * A QUESTION about the plan or its inputs. Answered, never filed.
   *
   * The third scope exists because the first two were an exhaustive split of one axis — is this
   * about this month, or is it for later? — and a question is not on that axis at all. Asked
   * "what ideas of mine are integrated into this month", the classifier read topic words and no
   * date and did the only thing it could: filed the question itself as a new idea. Four
   * phrasings, four new ideas, no answer (operator, 3 Aug).
   *
   * `kind` says which answerer: 'ideas' is computed from lifecycle, 'plan' from the month's
   * own beats. See `parsePlanQuestion`.
   */
  | { scope: 'question'; kind: PlanQuestionKind; sourceText: string };

export type PlanQuestionKind = 'ideas' | 'plan';

/**
 * What the MODEL can return.
 *
 * A question is decided before the model is asked — by grammar, deterministically — so
 * `routeFromParsed` can never produce one, and saying so in the type is what keeps every
 * existing `routing.intent` read narrowing correctly instead of needing a guard for a case
 * that cannot occur.
 */
export type ModelRouting = Exclude<IntakeRouting, { scope: 'question' }>;

/** Why an input went to the backlog. Surfaced in the receipt so "we filed this" is never
 *  mysterious, and recorded so a misroute is diagnosable rather than just annoying. */
export type EvergreenReason =
  | 'classified_evergreen'   // the model read it as a standing idea
  | 'ambiguous'              // the model was unsure — the asymmetry rule applied
  | 'validation_failed'      // output did not satisfy the contract
  | 'couldnt_apply'          // two extraction attempts failed — filed, and the client is TOLD
  | 'model_error';           // the call itself failed

/**
 * Framing for a segment that came from the DECOMPOSER — one item lifted out of a pasted brief.
 *
 * Added to the user message on the brief path ONLY; the direct single-sentence path never sees
 * it, so its prompt stays byte-identical. It exists because a span read in isolation loses the
 * frame the whole brief gave it: "On the 14th the stock leaves the factory" reads as a fact on
 * its own, but in a brief it is a post request; and "launch" is matching vocabulary, not always
 * a product launching. The framing restores the frame the split removed.
 */
export const BRIEF_SEGMENT_FRAMING = `CONTEXT: this is ONE item taken from a client's content brief — a list of things they want posted this month. Treat each item as a REQUEST FOR CONTENT unless it clearly is not one. A plain statement of fact in a brief ("On the 14th the stock leaves the factory") is a request to post about that, on that date. A dated item is about THIS MONTH (month-scoped) unless the date is plainly in the past.

LAUNCH vs EVENT — read this before choosing kind=launch: launch means a PRODUCT or COLLECTION is launching and wants a build-up arc (tease → launch → follow-up). A single requested post that merely MENTIONS a launch or its build-up is NOT a launch — it is an event (or beat_spec if it fully specifies one post). Examples:
- "The Navy Edit launches on the 28th" → kind=launch (the product is launching).
- "In the Navy Edit build-up, a colour-reveal post on the 25th, guess the main colour" → kind=event (one post inside the build-up, not the launch itself).`;

/**
 * ── IS THIS A QUESTION ABOUT THE PLAN? ───────────────────────────────────────────────
 *
 * Deterministic, and deliberately so. The classifier decided on TOPIC WORDS and DATELESSNESS:
 * "what ideas of mine are integrated into this month" mentions ideas, carries no date, and is
 * therefore — by that rule — a standing idea for the backlog. It had no concept of a question
 * at all, so the honest fix is not a better prompt but a missing distinction, made before the
 * model is asked anything.
 *
 * Three gates, and all three must pass:
 *
 *   1. IT IS INTERROGATIVE — a '?' or a leading wh/auxiliary word. Grammar, not vocabulary.
 *   2. IT IS ABOUT THE PLAN OR ITS INPUTS — a topic word. "What time is it?" is a question and
 *      not our business; it falls through to the model exactly as before.
 *   3. IT IS NOT A REQUEST IN QUESTION FORM. This is the gate that matters most and the one a
 *      naive implementation forgets. "Can we move the Friday post?" is interrogative and about
 *      the plan, and answering it instead of doing it would be a far worse regression than the
 *      bug being fixed: the whole reshape path is phrased that way half the time. An action
 *      verb aimed at the plan means DO IT, whatever the punctuation.
 *
 * A false negative here is harmless — the sentence goes to the model, which is what happened
 * before. A false positive stops a client changing their month. So every gate is written to
 * fail closed.
 */
/**
 * ── THE APOSTROPHE WAS LOAD-BEARING, AND NOBODY MEANT IT TO BE ──────────────────────
 *
 * `\b` after `what` matches "what's" — an apostrophe is a non-word character, so the boundary
 * holds — and does NOT match "whats", where the `s` is a word character and there is no
 * boundary at all. A client typing on a phone drops both the apostrophe and the question mark,
 * and gate 1 then rejects the sentence as not a question. Measured on the 19-question corpus:
 * 17 claimed as written, 17 with apostrophes stripped, 17 with the question mark stripped,
 * and 12 with BOTH gone. All five losses are contractions — "whats in September",
 * "whats on the 18th", "whats on next week" — and every one of them is filed as an idea,
 * silently, under the words "Saved to your ideas".
 *
 * Observed live: "whats happening the week after next", "whats happening in the last week of
 * august", "whats happening in the first week of september" — all three rejected HERE, at the
 * grammar gate, with `PLAN_TOPIC` matching "week" in every one. It was never the vocabulary.
 *
 * The fix is a second branch rather than a looser boundary. Making the `s` optional across the
 * whole list would admit "cans", "dos" and "ams"; these six tokens are the wh-words that
 * contract with is/has, and none of them is an English word in any other reading at the start
 * of a sentence.
 *
 * "theres" is deliberately NOT among them, though it is the same elision. English does not
 * form a question by fronting "there is" — the interrogative is "IS there anything on the 4th",
 * which the auxiliary branch already claims. "Theres nothing on the 4th" is a STATEMENT, and
 * admitting it here would claim statements as questions, which is the one false-positive
 * surface this change is otherwise free of. Pinned in plan-question.test.ts.
 */
const INTERROGATIVE_OPENERS =
  /^(?:(?:what|which|why|when|where|who|whose|whom|how|is|are|was|were|do|does|did|can|could|will|would|should|shall|has|have|had|am)\b|(?:what|when|where|who|how|why)s\b)/i;

/**
 * "tell me what…", "show me the ideas you used…" — a question wearing an imperative.
 *
 * The object is deliberately unconstrained. Requiring a wh-word after "me" missed one of the
 * four phrasings the operator actually typed ("Show me the ideas you used in this month's
 * plan"), and the thing that makes it safe to widen is that the ACTION-VERB gate runs first:
 * "show me" cannot smuggle a request through, because a request carries a verb that changes
 * something and that verb is what disqualifies it.
 */
const INDIRECT_QUESTION = /^(tell|show|remind|let)\s+me\b|^list\b/i;

/**
 * Words that make an utterance about THIS product rather than the world.
 *
 * Dates count. This composer is only ever pointed at a plan, so "is there anything on the 14th?"
 * is a question about the month even though it names nothing else — and a client checking a
 * date is one of the commonest things asked here.
 */
const PLAN_TOPIC = new RegExp([
  '\\b(plan|planned|planning|month|months|post|posts|posting|schedule|scheduled|calendar)\\b',
  '\\b(idea|ideas|input|inputs|note|notes|suggestion|suggestions|beat|beats|content)\\b',
  '\\b(reel|reels|carousel|carousels|caption|captions|week|weeks|draft|series|launch|pillar|pillars)\\b',
  '\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|weekend)\\b',
  '\\b\\d{1,2}(st|nd|rd|th)\\b',
  '\\b(january|february|march|april|may|june|july|august|september|october|november|december)\\b',
].join('|'), 'i');

/** The client's own contributions — the sub-topic with a computed answer of its own. */
const INPUT_TOPIC = /\b(idea|ideas|input|inputs|note|notes|suggestion|suggestions)\b|\b(i|we)\s+(said|told|sent|gave|asked)\b|\b(told|gave|sent)\s+you\b|\bof\s+mine\b|\bmy\s+(idea|ideas|input|inputs|note|notes)\b/i;

/**
 * A verb that asks us to CHANGE the plan. Its presence means the sentence is a request even
 * when it is punctuated as a question — "could you move the launch to the 3rd?" is an
 * instruction with a polite hat on.
 *
 * 'plan' is here only as a transitive verb ("plan a reel for Friday"); "what's planned" is the
 * passive and must not match, which is why the list carries no participles.
 *
 * THIS LIST IS EVIDENCE, NOT THE RULE. It was derived from the eight requests-in-question-form
 * in `plan-question.test.ts`, every one of which is a STRUCTURAL edit, and it inherited their
 * vocabulary: move, add, swap, delete. The register it cannot cover is EMPHASIS — "lean into",
 * "focus on", "prioritise", "feature", "highlight", "do", "have", "see", "keep", "run", "try" —
 * which has no bounded verb set to enumerate. `do` is absent and `redo` is present, and that is
 * not an oversight to patch but the shape of the mistake: "can we do more reels this month" was
 * answered as a question 5 times out of 5. `isRequestForChange` is what the gate now asks; this
 * stays as one of its two answers because it catches requests the register cannot (see there).
 */
const ACTION_VERB = /\b(move|add|change|swap|switch|push|pull|delete|remove|drop|make|put|shift|reschedule|replace|rewrite|write|create|schedule|cancel|postpone|bring|turn|shorten|lengthen|redo|fix|update|edit)\b/i;

/**
 * ── THE REQUEST REGISTER ─────────────────────────────────────────────────────────────
 *
 * A MODAL aimed at us. "Can we…", "could you…", "would you…" is how an owner asks for a change
 * to their month, and it is a register rather than a vocabulary: it is true of every request
 * regardless of which verb follows, which is exactly what a verb list can never be.
 *
 * Measured on this file's own corpus, which is the only reason to prefer it to more verbs:
 * all EIGHT requests-in-question-form open with a modal or "how about", and NONE of the four
 * phrasings the operator really typed does — those open What / Which / Have / Show me.
 *
 * THE AUXILIARIES ARE DELIBERATELY ABSENT. `is/are/was/were/do/does/did/has/have/had/am` invert
 * for a yes-no question ABOUT STATE — "is there anything on the 14th", "have any of the things I
 * told you been used this month". Putting `have` in here to catch "have you moved it" would cost
 * the third of the operator's four phrasings, and that phrasing is the whole reason this gate
 * exists. A modal asks us to act; an auxiliary asks us what is so.
 *
 * ── IT OPENS A CLAUSE, NOT ONLY A SENTENCE ───────────────────────────────────────
 *
 * Anchored at `^` this missed the commonest shape a client actually types: a statement and
 * then the ask. *"The Wilderness candle relaunches on the 24th, can we build up to it?"* —
 * real client input, from another client's brief — was claimed by the question gate and never
 * reached the classifier, because the modal is the eighth word rather than the first. The
 * register is a property of the CLAUSE the modal opens; where that clause sits in the sentence
 * is punctuation, not meaning.
 *
 * So the anchor is now a clause boundary: string start, a comma / semicolon / colon, a dash
 * (em, en, or a spaced hyphen), a sentence-ending full stop, or a newline. `\s-{1,2}\s*` wants
 * whitespace BEFORE the hyphen so that a hyphenated word can never supply the boundary.
 *
 * The blast radius is bounded by something already true rather than by this pattern's care:
 * gate 3 only ever sees sentences that passed GATE 1, so a plain statement containing a
 * mid-sentence modal is rejected as non-interrogative before this is consulted. Only a
 * sentence already carrying a '?', an interrogative opener or an indirect frame can be moved.
 */
const REQUEST_OPENER = /(?:^|[,;:]\s*|[—–]\s*|\s-{1,2}\s*|\.\s+|\n\s*)(?:can|could|would|will|shall|should|how\s+about)\b/i;

/**
 * A modal that is asking to be TOLD, not asking us to act — "can you tell me what's planned",
 * "could you list the posts". The indirect-question frame outranks the register: the modal here
 * is politeness wrapped round a question, and answering it is right.
 *
 * Distinct from INDIRECT_QUESTION, which is anchored at the start of the sentence. This one is
 * looked for AFTER the opener, because that is where a modal puts it.
 */
const ASKS_TO_BE_TOLD = /\b(?:tell|show|remind|let)\s+(?:me|us)\b|\blist\b/i;

/**
 * An embedded interrogative — "can we see WHAT's planned for the 14th". The wh-word is the
 * complement of the modal, so the sentence asks even though it opens in the request register.
 *
 * Tested against the text AFTER the opener, so that "How about we add a post" — where the
 * wh-word IS the opener — is not read as its own escape hatch.
 */
const EMBEDDED_WH = /\b(?:what|which|why|when|where|who|whose|whom|how)\b/i;

/**
 * Does this sentence ask us to CHANGE the month?
 *
 * ── Why this is not "more verbs" ─────────────────────────────────────────────────────
 *
 * The three gates used to compose to the opposite of their stated intent. Gate 1 is broad (every
 * modal and wh-word), gate 2 is broad (~40 topic words, every weekday, month and ordinal), and
 * the request check was a narrow 29-verb ALLOWLIST ANDed in as the only exception. Two wide gates
 * plus one narrow exception means the default outcome is "question" for everything the exception
 * misses — so a gate documented at `parsePlanQuestion` as failing closed in fact failed OPEN, and
 * "can we lean into the morning routine more this month" was answered rather than applied, 5
 * times out of 5. Adding six emphasis verbs would have fixed that sentence and left the property
 * that produced it exactly where it was.
 *
 * So the check now has TWO answers and keeps the list as one of them:
 *
 *   the REGISTER   catches every request phrased as one, whatever its verb.
 *   the VERB LIST  catches the requests the register cannot — a request that does not open with
 *                  a modal ("how about we add a post on the 20th"), and one whose embedded
 *                  wh-word would otherwise excuse it ("can we move the launch to when the stock
 *                  lands"). It runs FIRST for that reason.
 *
 * ── What this gets wrong, stated rather than tuned away ──────────────────────────────
 *
 * A genuine question wearing a modal, with no wh-complement and no "tell me": "should I be
 * worried about the gap in week 3?", "would you say September is full?". Those were answered
 * before and now fall through to the model. That is the direction this gate is documented to
 * fail in — a false negative costs one model call and the pre-existing behaviour, a false
 * positive stops a client changing their month — but it is a real loss and it is pinned in the
 * tests rather than hidden.
 */
function isRequestForChange(t: string): boolean {
  if (ACTION_VERB.test(t)) return true;

  const opener = REQUEST_OPENER.exec(t);
  if (!opener) return false;

  // From the end of the MATCH, not from `opener[0].length` — the opener no longer starts at
  // index 0, and slicing by length alone would hand the escapes a window offset by however
  // much text preceded the clause boundary.
  const rest = t.slice(opener.index + opener[0].length);
  if (ASKS_TO_BE_TOLD.test(rest)) return false;
  if (EMBEDDED_WH.test(rest)) return false;
  return true;
}

/** Moved to `operations.ts` so a client component can import it without the whole engine.
 *  Re-exported here because this is where the verb lists live and where a reader will look. */
export { namesAnOperation } from './operations.js';

/**
 * The question kind, or null when this is not a question about the plan.
 *
 * Exported for its own tests: this is a routing rule, and a routing rule that can only be
 * observed through two service layers is a routing rule nobody will check.
 */
export function parsePlanQuestion(text: string): PlanQuestionKind | null {
  const t = text.trim();
  if (!t) return null;

  // Gate 1 — grammar.
  const interrogative = t.endsWith('?') || INTERROGATIVE_OPENERS.test(t) || INDIRECT_QUESTION.test(t);
  if (!interrogative) return null;

  // Gate 3 first, because it is the expensive mistake. A request in question form is a request.
  if (isRequestForChange(t)) return null;

  // Gate 2 — is it about us at all?
  if (!PLAN_TOPIC.test(t)) return null;

  return INPUT_TOPIC.test(t) ? 'ideas' : 'plan';
}

export const CLASSIFY_SYSTEM = `You route a single message from a small brand's owner about their social media content plan.

Decide ONE thing: is this about THIS MONTH's plan specifically, or is it a standing idea for later?

MONTH_SCOPED — act on the current draft now:
- a launch, restock, event or campaign with a time attached ("the navy edit drops on the 28th")
- a REPEATING run of posts ("every Friday in August", "one post every 3 weeks", "a weekly series")
- a change to a specific planned post ("move the Friday reel to Saturday", "make the 3rd a carousel")
- a shift of emphasis — MORE or LESS of something the plan already has ("more product this month", "less founder stuff", "lean into the morning routine more")

EVERGREEN — a standing idea for the backlog:
- a NEW post or theme they might do one day ("we should do a founder story", "a post about why never to wear polyester")
- an idea for "sometime", "at some point", "in future", "next time", "one day", or in another month
- an observation about what works, or a line about what the brand stands for, with no instruction attached

RULES:
- AN EMPHASIS NEEDS NO DATE. The owner writes this while looking at THIS month's draft, on a screen that says so. "More X", "less X", "lean into X more" is therefore a reweighting of THIS month even with no time attached — do not file it for later because they did not repeat the month back to you. File an emphasis as EVERGREEN only when they point somewhere else in time ("sometime", "in future", "next time", "one day", or another month by name).
- THE LINE IS REWEIGHTING vs ADDING. "More of the morning routine" asks us to shift the balance of a plan that already exists, and is month-scoped. "We should do a founder story" asks for something NEW that is not there, and is a standing idea — as is a line about what the brand stands for, which is not an instruction at all. When an undated message is an ADDITION rather than a rebalance, it is still EVERGREEN.
- If you are not sure, choose EVERGREEN. Being filed as an idea is easy to undo; changing a month the owner was happy with is not. This tie-break stands everywhere EXCEPT an undated emphasis, which the two rules above have already decided.
- SERIES is any run of posts on a repeating pattern. "Every Friday", "one post every 3 weeks", "weekly", "monthly", "a mini-series" are ALWAYS kind=series and NEVER kind=launch. A series is a rhythm; a launch is one moment with a build-up. Do not turn a series into a launch because it has a start date.
- For a series, prefer ENUMERATED dates. If the owner lists the dates ("7th, 14th, 21st, 28th"), return instances:[{date,subject}] with one entry per date, and put THAT DATE'S OWN subject on it (the specific product, theme or story they named for it). Only use recurrence:{startDate,intervalDays} when they give a cadence with no list ("every 3 weeks from the 1st"). If they give both a list and a cadence, the list wins — return instances and leave recurrence null.
- CADENCE is a target NUMBER of posts, not a specific post: "we want 7 posts a week", "post daily", "at least 20 this month", "no more than 4 a week". Set kind=cadence, postsPerWeek for a weekly figure ("daily" = 7) and/or postsPerMonth for a monthly one. It carries no date and no title. "post more" or "we should post more often" with NO number is NOT cadence — that is an emphasis or an idea. The figure is a floor the owner is setting on the month; extract it, do not judge it.
- BEAT_SPEC is a single dated post the owner has SPELLED OUT — one date, an optional format, and a title, with no build-up and no repeat. "add a reel on the 22nd called What I am most proud of part 2", "a carousel on the 14th: Weekend Style Guide". Set kind=beat_spec, dateRange for the single date (start=end), format when they named one ("reel"/"carousel"/"single"), and subject = the title they gave, VERBATIM. It is NOT a launch (no tease/follow-up) and NOT a series (it happens once). Most typed rows are caught before you see them; use beat_spec for the ones phrased as a short request.
- CORRECTION is for fixing something already on the plan: "X is the 10th not the 1st", "actually the workshop is the 15th", "move the launch to the 3rd", "make the launch post a reel". Set kind=correction, correctionOf = the thing being corrected in the owner's words, and dateRange for a new date (or edit/editValue for a format change). A correction is NOT a new launch — do not use kind=launch to restate a date the owner is fixing.
- Do NOT invent a date. Only set dateRange when a real date or clear window is stated. Resolve relative dates ("next Friday", "the 28th") against the PLAN MONTH you are given.
- subject is a short noun phrase in the owner's own words. Do not embellish it.
- sourceText is the owner's message, VERBATIM.

Return ONE JSON object, no markdown, no code fences:
{"scope":"month_scoped","intent":{"kind":"launch|event|series|beat_spec|cadence|emphasis|beat_edit|correction","subject":"","sourceText":"","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|null,"format":null,"postsPerWeek":null,"postsPerMonth":null,"instances":null,"recurrence":null,"beatRef":null,"edit":null,"editValue":null,"emphasis":null,"correctionOf":null}}

For a single spelled-out post:
{"scope":"month_scoped","intent":{"kind":"beat_spec","subject":"What I am most proud of part 2","sourceText":"","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"format":"reel","instances":null,"recurrence":null,...}}

For a posting-cadence target:
{"scope":"month_scoped","intent":{"kind":"cadence","subject":"7 posts a week","sourceText":"","postsPerWeek":7,"postsPerMonth":null,...}}

For a series with listed dates:
{"scope":"month_scoped","intent":{"kind":"series","subject":"Weekend Style Guide","sourceText":"","instances":[{"date":"YYYY-MM-DD","subject":"what that date is about"}],"recurrence":null,...}}

For a series with a cadence and no list:
{"scope":"month_scoped","intent":{"kind":"series","subject":"","sourceText":"","instances":null,"recurrence":{"startDate":"YYYY-MM-DD","intervalDays":21,"count":null,"until":null},...}}
or
{"scope":"evergreen"}`;

/**
 * Tolerant parse — fenced, prose-wrapped, bare, or SELF-CORRECTED JSON.
 *
 * Shares json-salvage.ts with the decomposer, where the self-correction shape was found. This
 * is the hot path — every input the product takes runs through it — so the property that
 * matters here is that widening the scan cannot narrow the result: a response carrying exactly
 * one complete object parses to exactly what it did before. See json-salvage.ts.
 */
export function parseClassification(text: string): unknown {
  return parseLastJsonObject(text);
}

/**
 * Validate a parsed classification into a routing decision.
 *
 * EVERY failure path lands on evergreen. A malformed intent, a month_scoped verdict with
 * no intent attached, an unparseable response — all of them mean "we could not establish
 * that the client wanted their month changed", and the honest response to that is to file
 * the input, not to guess at a mutation. Exported so the fallback is directly testable
 * without a model.
 */
export function routeFromParsed(parsed: unknown, sourceText: string): ModelRouting {
  const outer = classificationSchema.safeParse(parsed);
  if (!outer.success) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
  if (outer.data.scope === 'evergreen') return { scope: 'evergreen', sourceText, reason: 'classified_evergreen' };

  if (!outer.data.intent) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
  const intent = monthScopedIntentSchema.safeParse(outer.data.intent);
  if (!intent.success) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };

  // A correction that names nothing to correct cannot be matched against the plan.
  if (intent.data.kind === 'correction' && !intent.data.correctionOf && !intent.data.subject) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A beat_edit that does not say WHAT to change cannot be applied deterministically.
  // Routing it to the backlog (with a receipt) beats guessing at the client's meaning.
  if (intent.data.kind === 'beat_edit' && (!intent.data.edit || !intent.data.beatRef)) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A launch or event with no date has no anchor to place an arc against.
  if ((intent.data.kind === 'launch' || intent.data.kind === 'event') && !intent.data.dateRange) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A series needs a rhythm. Neither a list nor a rule means the model read "series" out of
  // words like "mini-series" without any timing behind it — which is an idea for the
  // backlog, not a run of dated posts. Filing it is right; inventing a cadence is not.
  if (intent.data.kind === 'series'
      && !(intent.data.instances && intent.data.instances.length > 0)
      && !intent.data.recurrence) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A beat_spec is a typed calendar row — it needs a date to place it. The title (subject)
  // is already required by the schema; without a date there is nowhere to put the post, so
  // it is filed rather than dropped on the month at a guessed date.
  if (intent.data.kind === 'beat_spec' && !intent.data.dateRange) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }
  // A cadence needs a NUMBER — "post more" without a figure is an emphasis, not a floor.
  // Neither field set means the model read "cadence" out of a vague ask; file it.
  if (intent.data.kind === 'cadence'
      && !(typeof intent.data.postsPerWeek === 'number')
      && !(typeof intent.data.postsPerMonth === 'number')) {
    return { scope: 'evergreen', sourceText, reason: 'ambiguous' };
  }

  // Trust the model for meaning, never for provenance: sourceText is overwritten with the
  // text we actually received, so a receipt can never quote words the client did not send.
  return { scope: 'month_scoped', intent: { ...intent.data, sourceText }, sourceText };
}

// ── Deterministic beat_spec pre-parse ───────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * A typed calendar ROW: an optional weekday, a day, a month name, an optional format word,
 * then the title. Date-leading by construction — there is no verb before the date to make it
 * a request. "Sat 22 Aug Reel What I am most proud of… — part 2" is this shape.
 */
const BEAT_SPEC_RE =
  /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(reels?|carousels?|singles?))?\s+(\S[\s\S]*?)\s*$/i;

/** A title that opens with one of these is a request ("move the reel…"), not a row title —
 *  let the model classify it rather than titling a beat with an instruction. */
const INTENT_VERB_RE = /^(?:move|add|make|change|swap|remove|drop|delete|shift|reschedule|turn|set|put)\b/i;

/**
 * Recognise a typed calendar row without the model.
 *
 * The rehearsal showed operators typing ROWS, not requests, and two of them bounced to the
 * ideas backlog twice (docs/reports/ivy-t-rehearsal-failures.md). A date-leading
 * [date][format?][title] line is not a question to route — it is a beat to place, literally:
 * the given date, the named format (or the month's commonest, decided later by the transform),
 * and the title VERBATIM. So it short-circuits the one model call entirely.
 *
 * Conservative on purpose: no leading date, no real month, an empty title, or a title that
 * opens with an instruction verb all return null and fall through to the model. This claims
 * only the inputs it is certain about; the model (and then the asymmetry rule) owns the rest.
 *
 * Pure and exported so the contract is testable without a model call. `planMonth` supplies the
 * year — a typed row names a day and a month, never a year.
 */
export function parseBeatSpec(text: string, planMonth: string): MonthScopedIntent | null {
  const line = text.trim();
  if (!line || /\n/.test(line)) return null;         // a paragraph is a message, not a row

  const m = BEAT_SPEC_RE.exec(line);
  if (!m) return null;

  const day = Number(m[1]);
  const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
  if (!month || day < 1 || day > 31) return null;

  const title = (m[4] ?? '').trim();
  if (!title || INTENT_VERB_RE.test(title)) return null;

  const year = Number(planMonth.slice(0, 4));
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const fmtRaw = m[3]?.toLowerCase().replace(/s$/, '');
  const format = fmtRaw === 'reel' || fmtRaw === 'carousel' || fmtRaw === 'single' ? fmtRaw : null;

  return {
    kind: 'beat_spec',
    subject: title,
    sourceText: line,
    dateRange: { start: date, end: date },
    ...(format ? { format } : {}),
  };
}

export interface ClassifyParams {
  text:      string;
  planMonth: string;            // 'YYYY-MM' — relative-date resolution context
  model:     ModelClient;
  modelName?: string;
  logger?:   Logger;
  audit?:    AuditLogger;
  clientId?: string;
  /**
   * Set to 'brief_segment' when this text is one segment from the DECOMPOSER, so the model is
   * told the framing the split removed. Omitted on the direct single-sentence path, which keeps
   * its prompt byte-identical. See BRIEF_SEGMENT_FRAMING.
   */
  context?:  'brief_segment';
}

/**
 * Classify one intake input. NEVER throws — a model failure routes to the backlog, because
 * an input the client typed must always land somewhere.
 */
export async function classifyIntake(params: ClassifyParams): Promise<IntakeRouting> {
  const { text, planMonth, model, modelName = 'sonnet', logger, audit, clientId, context } = params;
  const sourceText = text.trim();
  if (!sourceText) return { scope: 'evergreen', sourceText, reason: 'validation_failed' };

  // A QUESTION IS ANSWERED, NEVER FILED — and that is decided here, before the model, for the
  // same reason the typed row is: it is a fact about the sentence's grammar, not a judgement
  // about its content, and a judgement is what went wrong. See `parsePlanQuestion`.
  const question = parsePlanQuestion(sourceText);
  if (question) {
    logger?.info({ planMonth, kind: 'question', questionKind: question, preParsed: true },
      'intake-classify: question about the plan — no model call, routed to the answerer');
    return { scope: 'question', kind: question, sourceText };
  }

  // A typed calendar row is applied literally, without a model call. The deterministic
  // pre-parse runs FIRST: a date-leading [date][format?][title] line is a beat to place, not
  // a request to interpret, so it never reaches Bedrock.
  const spec = parseBeatSpec(sourceText, planMonth);
  if (spec) {
    logger?.info({ planMonth, kind: 'beat_spec', preParsed: true }, 'intake-classify: typed row pre-parsed — no model call');
    return { scope: 'month_scoped', intent: spec, sourceText };
  }

  // The framing is added ONLY for a decomposed brief segment. With no context the array is
  // exactly the direct-path message it has always been — byte-identical.
  const user = [
    ...(context === 'brief_segment' ? [BRIEF_SEGMENT_FRAMING, ''] : []),
    `PLAN MONTH: ${planMonth} (resolve any relative date against this month)`,
    '',
    'OWNER’S MESSAGE:',
    sourceText,
    '',
    'Route it now. JSON only.',
  ].join('\n');

  // ONE RETRY, then honesty. A single schema miss is usually a bad sample, not a bad
  // request — the uat data shows a client correcting a launch date twice and being filed as
  // an "idea" both times with no signal that nothing had happened
  // (docs/reports/wrong-month-generated.md §6). Retrying costs one call; the alternative
  // cost that client their month.
  const attempt = async (): Promise<IntakeRouting> => {
  try {
    const res = await model.complete({
      model: modelName, system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: user }],
      // NOTE: the engine-local ModelCompleteParams has no `temperature`. A routing
      // decision ideally would not vary between identical inputs; the safety net is
      // that every failure mode here lands on evergreen, so variance costs a tap.
      maxTokens: 600,
    });

    if (audit && clientId) {
      try {
        await audit.logModelCall({
          clientId, modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          action: 'content-cycle:intake-classify', metadata: { planMonth },
        });
      } catch { /* auditing must never change routing */ }
    }

    // Parsed separately from the call so the two failures stay distinguishable: the model
    // answering with junk is not the same event as the model being unreachable, and a
    // misroute is only diagnosable if the receipt records which one happened.
    let parsed: unknown;
    try {
      parsed = parseClassification(res.content);
    } catch (parseErr) {
      logger?.warn({ planMonth, err: String(parseErr) }, 'intake-classify: unparseable output — routing to the backlog');
      return { scope: 'evergreen', sourceText, reason: 'validation_failed' };
    }

    const routing = routeFromParsed(parsed, sourceText);
    logger?.info({ planMonth, scope: routing.scope, ...(routing.scope === 'evergreen' ? { reason: routing.reason } : { kind: routing.intent.kind }) },
      'intake-classify: routed');
    return routing;
  } catch (err) {
    logger?.warn({ planMonth, err: String(err) }, 'intake-classify: model call failed — routing to the backlog');
    return { scope: 'evergreen', sourceText, reason: 'model_error' };
  }
  };

  const first = await attempt();
  // Only a FAILURE to extract is retried. A confident 'classified_evergreen' is an answer,
  // not a miss, and asking twice would just spend money to hear it again.
  if (first.scope !== 'evergreen' || first.reason !== 'validation_failed') return first;

  logger?.info({ planMonth }, 'intake-classify: extraction failed — retrying once');
  const second = await attempt();
  if (second.scope === 'month_scoped') return second;
  if (second.scope === 'evergreen' && second.reason !== 'validation_failed') return second;

  // Twice is a pattern, not a blip. File it — but as couldnt_apply, so the receipt can say
  // so rather than presenting it as a filing the client asked for.
  logger?.warn({ planMonth }, 'intake-classify: extraction failed twice — filing as couldnt_apply');
  return { scope: 'evergreen', sourceText, reason: 'couldnt_apply' };
}
