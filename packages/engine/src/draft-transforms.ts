/**
 * draft-transforms.ts — apply an extracted intent to a draft month. Deterministically.
 *
 * The model decided WHAT the client wants (intake-classify.ts). These functions decide
 * what that does to the plan, and they do it with named rules over sorted rows — no model
 * call, no randomness, same input same output. That split is the whole design: the client
 * can be told exactly why a beat moved, because a rule moved it.
 *
 * ── The replacement rule ──────────────────────────────────────────────────────
 * A month has a fixed slot count. Adding a launch arc means something else goes. What goes
 * is decided by TIER — the client's hand outranks the machine, newer words outrank older:
 *   tier 0  template-basis beats   — we had no history to justify these at all
 *   tier 1  observed beats, weakest evidence first (smallest n, then lowest engagement)
 *   tier 2  beats an EARLIER input created and the client never touched — last resort,
 *           oldest application first
 * and NEVER:
 *   - a beat the client has touched (beat_meta.clientTouched) — their hand outranks the
 *     algorithm, always
 *   - a beat the client added themselves (basis 'client_added')
 *   - an experiment beat sourced from a client idea — they asked for that specifically
 *
 * See replacementTier for why tier 2 exists: protecting an earlier sentence's output forever
 * made each sentence immunise the month against the next one, and the pool starved.
 *
 * Slot count never grows. If nothing is replaceable, the transform reports that rather
 * than silently exceeding the month or silently doing nothing.
 *
 * Pure. Takes rows, returns a plan of row operations. The caller does the writing.
 */
import type { BeatMeta, BeatRationaleEvidence } from '@sprigly/db';
import type { MonthScopedIntent } from './intake-classify.js';
import { cadenceFloorSlots } from './draft-skeleton.js';
import type { BriefArcDates } from './brief-schedule.js';
import { spreadPillars } from './pillar-weights.js';

/** The subset of a draft row these transforms reason about. */
export interface TransformBeat {
  id:       string;
  date:     string;             // 'YYYY-MM-DD'
  format:   string;
  pillar:   string;
  title:    string;
  position: number;
  beatMeta: BeatMeta | null;
}

export type BeatOp =
  | { op: 'add';    date: string; format: string; pillar: string; title: string; beatMeta: BeatMeta }
  | { op: 'remove'; id: string }
  | { op: 'update'; id: string; changes: { date?: string; format?: string; pillar?: string; title?: string }; beatMeta?: BeatMeta };

/** A series instance that falls outside this plan month — handed back for the caller to file. */
export interface DeferredInstance {
  /** The date the client asked for, kept exactly. Filing it undated would lose the ask. */
  date:    string;
  subject: string;
}

export interface TransformResult {
  ops: BeatOp[];
  /**
   * MONTH CONTEXT THE TRANSFORM COULD NOT PLACE.
   *
   * Set when the input is genuinely about this month but names nothing to move, add or
   * reweight — "the back to school element should talk about the juggle of the school run".
   * There is no beat to change, and inventing one would put a post on a date the client
   * never gave. But it is not an idea for later either: it is what this month's captions
   * should be about.
   *
   * The caller writes it to `intake_json.planContent.freeNotes`, which is the ONE
   * cycle-level field the caption generator reads (planning.ts:471 → buildPlanningUserMessage
   * → `FREE NOTES:` → regeneratePost's user message). Every `client_input` transform before
   * this one put the client's sentence in `beat_meta.rationaleEvidence.reason`, which nothing
   * downstream of the receipt has ever read.
   *
   * Distinct from `note`: `note` is what the client is TOLD, this is what is KEPT. A result
   * carrying context still reports zero ops, because the month's shape must not change —
   * they did not ask for posts.
   */
  context?: string;
  /** Why nothing (or less than asked) happened. Surfaced to the client, never swallowed. */
  note?: string;
  /**
   * DID THE TRANSFORM UNDERSTAND WHAT WAS ASKED?
   *
   * A NEW SIGNAL, and the reason it had to be added rather than inferred: twenty-five returns in
   * this file report zero ops, and they are two entirely different events wearing one shape.
   *
   *   understood, nothing to do   "Recorded 7 posts a week as your floor. You have 9 posts this
   *                               month" · "The rest of the month is already yours or already
   *                               leaning toward X" · every post in the series falls next month ·
   *                               there is no room to displace anything.
   *   NOT understood              "It wasn't clear what to change about X" · "It wasn't clear
   *                               which post you meant" · "We couldn't find X in this month" ·
   *                               "No date was given" · "X could be N different posts".
   *
   * Both landed on `reason: 'not_applicable'` and therefore on one heading. Live: "move one of
   * the posts from the 18th September to the next empty day" — the subject resolved, the date did
   * not, and the client was told *"Nothing changed in September"*, which reads as a success over a
   * failure to understand them.
   *
   * The note's WORDING is not the signal. It is prose written for a client, it is edited, and
   * matching on it would make the copy depend on a phrase nobody would think to keep stable. The
   * transform knows which of the two happened at the moment it returns; this is it saying so.
   *
   * Absent means understood — every zero-op return that is a legitimate no-change stays as it
   * was, and only the fifteen that could not resolve the request set it.
   */
  unresolved?: boolean;
  /**
   * Instances the transform deliberately did NOT place because they fall beyond the plan
   * month. These are not failures and must not be silently dropped: the client asked for a
   * September post and is entitled to have it survive somewhere they can see. The transform
   * is pure, so it names them and the caller writes them to the backlog.
   */
  deferred?: DeferredInstance[];
}

// ── Protection and ranking ────────────────────────────────────────────────────

/** Has the client's own hand been on this beat? Set by the Build B mutations. */
export function isClientTouched(beat: TransformBeat): boolean {
  return (beat.beatMeta as { clientTouched?: unknown } | null)?.clientTouched === true;
}

/** An experiment the client asked for, or a beat a previous input of theirs created.
 *  NOT the replaceability test any more — see replacementTier, which distinguishes a beat
 *  the client placed from a beat the machine placed on an earlier sentence's behalf. Kept
 *  because "did this originate with the client at all" is still a question worth asking. */
export function isClientOriginated(beat: TransformBeat): boolean {
  const meta = beat.beatMeta;
  if (!meta) return false;
  const basis = meta.rationaleEvidence?.basis;
  if (basis === 'client_added' || basis === 'client_input') return true;
  return meta.slotType === 'experiment' && meta.rationaleEvidence?.candidateRank?.origin === 'client';
}

/** Was this beat placed by the client's own hand (the Build B "add" affordance)? */
export function isClientAdded(beat: TransformBeat): boolean {
  return beat.beatMeta?.rationaleEvidence?.basis === 'client_added';
}

/** Was this beat placed by an EARLIER intake sentence, and left alone since? */
export function isFromEarlierInput(beat: TransformBeat): boolean {
  return beat.beatMeta?.rationaleEvidence?.basis === 'client_input' && !isClientTouched(beat);
}

/**
 * Replacement tiers — lower goes first, `null` is never replaceable.
 *
 * The rule in one line: **the client's hand outranks the machine, and newer words outrank
 * older words.**
 *
 * Tier 3 is the change. It used to be that anything a previous input created was protected
 * forever, which sounds respectful and isn't: ivy-t's rehearsal drove the pool from 21 beats
 * to 5 in eleven sentences, because every sentence's output immunised itself against the next
 * sentence (docs/reports/ivy-t-rehearsal-failures.md F3, "a different, real refusal"). The
 * client would have hit "every beat this month is either yours or already earning its place"
 * within a few more inputs, having never touched a single beat themselves.
 *
 * A beat the machine wrote from an earlier sentence is not the client's hand — it is our
 * guess at an earlier sentence, and their newer sentence is better evidence of what they want
 * than our older guess. A beat they actually TOUCHED, or added themselves, still outranks
 * everything, and that is the distinction that matters.
 */
export function replacementTier(beat: TransformBeat): 0 | 1 | 2 | null {
  if (isClientTouched(beat)) return null;                     // their hand — always
  if (isClientAdded(beat))   return null;                     // they placed it themselves
  const meta = beat.beatMeta;
  if (meta && meta.slotType === 'experiment'
      && meta.rationaleEvidence?.candidateRank?.origin === 'client') return null;   // they asked for this experiment

  if (isFromEarlierInput(beat)) return 2;                     // last resort, oldest first
  const basis = meta?.rationaleEvidence?.basis;
  if (!meta || basis === 'template') return 0;                // nothing ever justified it
  return 1;                                                   // observed
}

/** May this beat be replaced to make room for something the client asked for? */
export function isReplaceable(beat: TransformBeat): boolean {
  return replacementTier(beat) !== null;
}

/**
 * Evidence strength, lowest first. Ties break on date then id, so the ordering is total
 * and the same month always yields the same replacement — a tie resolved by array position
 * would be a tie resolved by row order, which is not determinism.
 */
export function byWeakestEvidence(a: TransformBeat, b: TransformBeat): number {
  const rank = (x: TransformBeat): number => {
    const ev = x.beatMeta?.rationaleEvidence;
    if (!ev || ev.basis === 'template') return 0;        // no history behind it at all
    return 1;
  };
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;

  const n = (x: TransformBeat): number => x.beatMeta?.rationaleEvidence?.formatEngagement?.posts ?? 0;
  if (n(a) !== n(b)) return n(a) - n(b);                 // smallest sample = weakest claim

  const e = (x: TransformBeat): number => x.beatMeta?.rationaleEvidence?.formatEngagement?.avgEngagement ?? 0;
  if (e(a) !== e(b)) return e(a) - e(b);

  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

/**
 * Replacement candidates, weakest first, optionally preferring beats near a date.
 *
 * TIER dominates every other consideration: a tier-2 beat (an earlier input's untouched
 * output) is only ever reached once tiers 0 and 1 are exhausted, however weak its evidence
 * looks. Within tier 2, OLDEST APPLICATION FIRST — `position` is the ordering, because
 * writeOps assigns positions from `max(position) + 1` per application, so a later
 * application's beats always carry higher positions than an earlier one's. That makes
 * position a true application-order key here rather than a proxy for one.
 */
export function replacementCandidates(beats: TransformBeat[], nearDate?: string): TransformBeat[] {
  const tierOf = (b: TransformBeat) => replacementTier(b) ?? 99;
  const pool = beats
    .filter(isReplaceable)
    .sort((a, b) =>
      tierOf(a) - tierOf(b)
      || (tierOf(a) === 2 ? a.position - b.position || a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : 0)
      || byWeakestEvidence(a, b));
  if (!nearDate) return pool;
  // Among equally weak beats, take the one nearest the client's date — a launch tease
  // should displace something that week, not something three weeks away. Tier still leads:
  // proximity decides WITHIN a tier and never promotes a tier-2 beat over a tier-0 one.
  const dist = (d: string) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${nearDate}T00:00:00Z`));
  return pool.sort((a, b) =>
    tierOf(a) - tierOf(b)
    || (tierOf(a) === 2 ? a.position - b.position : 0)
    || byWeakestEvidence(a, b)
    || dist(a.date) - dist(b.date));
}

/**
 * The one honest sentence for "there is nowhere to put this".
 *
 * Shared by every placing transform so the client meets the same words whichever kind of
 * input ran out of room, and told what to DO about it — a refusal that names no remedy is
 * just a wall.
 */
export const POOL_EMPTY_NOTE =
  'Every beat this month is either yours or already earning its place — add a day or drop something to make room.';

/**
 * Name a tier-2 displacement in terms the client can act on.
 *
 * They need to know we moved something they asked for earlier, because that is the one
 * category of replacement they might want to undo. Tiers 0-1 need no line: displacing a beat
 * we generated is the ordinary cost of a new ask and saying so on every application would be
 * noise.
 */
function displacementNote(victims: TransformBeat[]): string | undefined {
  const n = victims.filter((v) => replacementTier(v) === 2).length;
  if (n === 0) return undefined;
  return n === 1
    ? 'Made room by replacing a post from an earlier request.'
    : `Made room by replacing ${n} posts from earlier requests.`;
}

// ── Titles ────────────────────────────────────────────────────────────────────

/** Longest a derived title may be. Past this a card stops being scannable and the title
 *  stops doing its job, which is to let the client find the post at a glance. */
const TITLE_MAX = 60;

/**
 * Derive a beat title from an intent subject.
 *
 * The transforms used to write `intent.subject` verbatim. The classifier asks for "a short
 * noun phrase in the owner's own words", but `subject` is only bounded at 200 chars, and on
 * real briefing text the model returned whole sentences. ivy-t's plan ended up with six beats
 * titled with raw briefing prose, one clipped mid-date at the 200-char bound —
 * "…grey marl; 14th" (docs/reports/ivy-t-rehearsal-failures.md F1). Those are not titles;
 * they are input echoes, and the client saw them on their plan.
 *
 * Deterministic, no model: take the first clause, drop any trailing enumeration or date
 * fragment, and cap on a word boundary. The FULL text is untouched in
 * beat_meta.rationaleEvidence.reason, so nothing is lost — the receipt and the rationale
 * still quote the client's own words in full. Only the card gets a readable label.
 */
export function deriveTitle(subject: string): string {
  const cleaned = subject.replace(/\s+/g, ' ').trim();
  // CLIENT-FACING: this lands in source_meta.title and is what the card and the sheet show.
  // "planned post", never "beat" (spec §7) — the app's terminology fence cannot see this file,
  // which is exactly why the word survived here after it was removed everywhere else.
  if (!cleaned) return 'Untitled post';

  // Split on hard separators that end a thought. Sentence-enders and list separators only —
  // a comma is too aggressive ("Lily tee and Sophie short co-ord set, navy" is one product,
  // not two clauses).
  const clauses = cleaned.split(/(?:[.;:!?]|\s[—–-]\s)\s*/).map((c) => c.trim()).filter(Boolean);

  // Take the first SUBSTANTIVE clause, not merely the first one. Clients lead with the date
  // constantly — "14th August — the stock leaves the factory" — and taking clause one there
  // titles the beat "14th August", which tells them nothing they can't already see in the
  // date column. A bare date is a position, not a subject.
  const isBareDate = (c: string) =>
    /^\d{1,2}(?:st|nd|rd|th)?(?:\s+\w+)?$/i.test(c) || /^\d{4}-\d{2}-\d{2}$/.test(c);
  const clause = clauses.find((c) => !isBareDate(c) && c.length >= 12) ?? clauses[0] ?? cleaned;

  // Trailing enumerations and dangling dates: "…: 7th", "…, 14th August", "… 2026-08-07".
  const trimmed = clause
    .replace(/[\s,;:—–-]+\d{1,2}(?:st|nd|rd|th)?(?:\s+\w+)?$/i, '')
    .replace(/[\s,;:—–-]+\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[\s,;:—–-]+$/, '')
    .trim() || clause;

  if (trimmed.length <= TITLE_MAX) return trimmed;

  // Word-boundary cap. Cut at the last space inside the budget; if there isn't one (a single
  // enormous token) take the hard slice rather than returning something longer than the cap.
  const slice = trimmed.slice(0, TITLE_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  const capped = (lastSpace > TITLE_MAX * 0.5 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:—–-]+$/, '');
  return `${capped}…`;
}

/** Evidence for a beat that exists because the client said so. No metrics pretended. */
function clientInputMeta(sourceText: string, slotType: 'proven' | 'experiment' = 'proven'): BeatMeta {
  return {
    slotType,
    // 'client_input' is distinct from 'client_added' (Build B's manual add): this beat came
    // from something the client WROTE, and the receipt quotes it back.
    rationaleEvidence: { basis: 'client_input', reason: sourceText } as BeatMeta['rationaleEvidence'],
  };
}

/**
 * Evidence for a beat an emphasis moved.
 *
 * REPLACES rather than merges. A re-pillared beat that kept its observed evidence would
 * render "Everyday Ritual is about 20% of what you post" while sitting under a different
 * pillar entirely — stale rather than false, but misleading, and a client who catches one
 * wrong rationale has no reason to trust the others. The honest evidence for a beat the
 * client asked us to lean is that the client asked us to lean it.
 *
 * The upgrade, when it is worth the work: recompute the beat's real evidence via the
 * assembler primitives under the adjusted weights, so it can cite the NEW pillar's share.
 * Recorded as a backlog item rather than done here — it needs the assembler's inputs
 * threaded into the transform, which is a bigger change than this correction.
 */
function reweighted(beat: TransformBeat, sourceText: string): BeatMeta {
  const base: BeatMeta = beat.beatMeta ?? { slotType: 'proven', rationaleEvidence: { basis: 'template' } };
  return {
    ...base,
    rationaleEvidence: { basis: 'emphasis_reweight', reason: sourceText } as BeatMeta['rationaleEvidence'],
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const dayMs = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
const parse = (d: string): number => Date.parse(`${d}T00:00:00Z`);

/** Clamp an ISO date into the plan month, so a transform can never place a beat outside it. */
function clampToMonth(date: string, month: string): string {
  const first = `${month}-01`;
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  return date < first ? first : date > last ? last : date;
}

// ── Transforms ────────────────────────────────────────────────────────────────

/** The shape of a launch: build interest, announce, follow through. */
const LAUNCH_ARC: ReadonlyArray<{ offsetDays: number; label: string; format: string }> = [
  { offsetDays: -5, label: 'Tease',     format: 'single'   },
  { offsetDays:  0, label: 'Launch',    format: 'reel'     },
  { offsetDays:  3, label: 'Follow-up', format: 'carousel' },
];

/** The arc's part labels, for the readers that have to RECOGNISE one of its beats later.
 *  Exported from here so the suffix a title carries and the suffix something looks for are
 *  the same list — two copies of these three words is how a rename stops being detected. */
export const LAUNCH_ARC_LABELS: readonly string[] = LAUNCH_ARC.map((p) => p.label);

/** The em-dash join `applyLaunchArc` writes between a subject and its part label. */
const ARC_JOIN = ' — ';

/**
 * The SUBJECT of a launch-arc beat, read back off the title it was given, or null when the
 * title is not an arc beat's at all.
 *
 * `applyLaunchArc` writes `${deriveTitle(intent.subject)} — ${part.label}`, so "Molly — Launch"
 * yields "Molly". Nothing else on the surface writes that suffix.
 *
 * ── THIS READS A STRING BECAUSE IT HAS TO, NOT BECAUSE IT SHOULD ────────────────────
 *
 * The right home for "this beat is a launch, and its subject is X" is a FIELD on `beat_meta`,
 * written by `applyLaunchArc` at placement, beside the `client_input` basis it already writes.
 * A field cannot be broken by re-titling a card, and this can.
 *
 * It is not that, because a field written at placement is blind to every beat ALREADY placed —
 * including the three this exists for, which are sitting in a draft month that must not be
 * regenerated. Parsing the title is what can see them. When those rows are gone (or a backfill
 * is worth its own risk), the field is the change to make and this becomes its fallback.
 */
export function launchArcSubject(title: string | null | undefined): string | null {
  const t = (title ?? '').trim();
  for (const label of LAUNCH_ARC_LABELS) {
    const suffix = ARC_JOIN + label;
    if (t.length > suffix.length && t.endsWith(suffix)) {
      const subject = t.slice(0, -suffix.length).trim();
      return subject.length > 0 ? subject : null;
    }
  }
  return null;
}

/**
 * Allocate a launch arc around the stated date, replacing the weakest beats to make room.
 *
 * Places all three parts it can. If only two slots are replaceable it places two and SAYS
 * so — a partial arc the client can see is better than a full arc that quietly evicted a
 * beat they cared about, and better than silence.
 */
export function applyLaunchArc(
  intent: MonthScopedIntent, beats: TransformBeat[], month: string,
  /** Dates the brief already resolved for this subject. Empty → the constant, unchanged. */
  given: BriefArcDates = {},
): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nothing to build the launch around.', unresolved: true };
  const anchor = intent.dateRange.start;

  const pool = replacementCandidates(beats, anchor);
  if (pool.length === 0) return { ops: [], note: POOL_EMPTY_NOTE };

  const { parts, dropped } = arcDates(anchor, month, given);

  const ops: BeatOp[] = [];
  const used = new Set<string>();
  const victims: TransformBeat[] = [];
  for (const part of parts) {
    const victim = pool.find((b) => !used.has(b.id));
    if (!victim) break;
    used.add(victim.id);
    victims.push(victim);
    ops.push({ op: 'remove', id: victim.id });
    ops.push({
      op: 'add',
      date:   part.date,
      format: part.format,
      pillar: victim.pillar,   // keep the displaced beat's pillar — the month's balance holds
      title:  `${deriveTitle(intent.subject)} — ${part.label}`,
      beatMeta: clientInputMeta(intent.sourceText),
    });
  }

  const placed = ops.filter((o) => o.op === 'add').length;
  const notes: string[] = [];
  if (placed < parts.length) {
    notes.push(`Added ${placed} of ${parts.length} posts for ${intent.subject} — the rest of the month is already spoken for.`);
  }
  if (dropped) notes.push(dropped);
  const displaced = displacementNote(victims);
  if (displaced) notes.push(displaced);
  return notes.length > 0 ? { ops, note: notes.join(' ') } : { ops };
}

/**
 * Resolve the arc's three parts to distinct, in-month, correctly-ordered dates.
 *
 * The bug this exists for: `clampToMonth` pinned the tease's -5 offset to the month's first
 * day, so a launch anchored on the 1st put the tease ON the launch — two beats of one arc on
 * one date, which is not an arc (docs/reports/ivy-t-rehearsal-failures.md F2). Nothing
 * checked for the collision because nothing looked at the parts together.
 *
 * The rule, deterministic in both directions:
 *   - a tease colliding with the launch slides to the first FREE EARLIER day in the month
 *   - if there is no earlier day (anchor IS the month start), the tease is DROPPED and said
 *   - the follow-up mirrors it against the month end
 *
 * Dropping beats shifting-forward deliberately: a tease after its launch is not a tease, and
 * silently reordering the arc would teach the client that our labels don't mean anything.
 *
 * ── WHERE THE BRIEF DATED A PART, THE BRIEF WINS ─────────────────────────────────────
 *
 * LAUNCH_ARC's [-5, 0, +3] is a shape we assume when we know nothing. It is not what anyone
 * asked for, and while it was the only source of offsets "a teaser the week before" was
 * unachievable no matter which date anchored the arc — the tease landed five days out because
 * five is the number in the constant. `given` carries whatever the extractor resolved for
 * this subject (brief-schedule.ts), and each part takes its own date from it INDEPENDENTLY:
 * a brief that names a tease and no follow-up gets the client's tease and the constant's
 * follow-up, rather than all-or-nothing on either side.
 *
 * The clamping below is unchanged and applies identically to a brief-supplied date. A client
 * naming a tease outside the plan month is in exactly the position a computed offset that
 * falls off the edge is in, and gets the same answer — the month is the month.
 */
function arcDates(anchor: string, month: string, given: BriefArcDates = {}): {
  parts: Array<{ date: string; label: string; format: string }>;
  dropped?: string;
} {
  const first = clampToMonth(`${month}-01`, month);
  const last  = clampToMonth(`${month}-31`, month);
  const at = (offset: number) => clampToMonth(iso(parse(anchor) + offset * dayMs), month);
  /** The brief's date for a part, clamped like any other, or the constant's offset. */
  const wanted = (briefDate: string | undefined, offsetDays: number) =>
    briefDate ? clampToMonth(briefDate, month) : at(offsetDays);

  const launchDate = at(0);
  const parts: Array<{ date: string; label: string; format: string }> = [];
  const notes: string[] = [];

  // Tease — must land strictly BEFORE the launch.
  const teasePart = LAUNCH_ARC[0]!;
  const teaseWanted = wanted(given.tease, teasePart.offsetDays);
  if (teaseWanted < launchDate) {
    parts.push({ date: teaseWanted, label: teasePart.label, format: teasePart.format });
  } else if (launchDate > first) {
    parts.push({ date: iso(parse(launchDate) - dayMs), label: teasePart.label, format: teasePart.format });
  } else {
    notes.push('The launch is at the very start of the month, so there was no room for a tease before it.');
  }

  parts.push({ date: launchDate, label: LAUNCH_ARC[1]!.label, format: LAUNCH_ARC[1]!.format });

  // Follow-up — must land strictly AFTER the launch. Same rule, mirrored off the month end.
  const followPart = LAUNCH_ARC[2]!;
  const followWanted = wanted(given.followUp, followPart.offsetDays);
  if (followWanted > launchDate) {
    parts.push({ date: followWanted, label: followPart.label, format: followPart.format });
  } else if (launchDate < last) {
    parts.push({ date: iso(parse(launchDate) + dayMs), label: followPart.label, format: followPart.format });
  } else {
    notes.push('The launch is on the last day of the month, so the follow-up moves to next month’s plan.');
  }

  return notes.length > 0 ? { parts, dropped: notes.join(' ') } : { parts };
}

// ── Series ────────────────────────────────────────────────────────────────────

/** Is this date inside the plan month? */
function inMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month;
}

/**
 * Expand a series intent into the dates it actually asks for, in order, deduplicated.
 *
 * Enumerated instances WIN over a recurrence rule when both are present: a date the client
 * listed is something they stated, a date we computed is something we inferred, and the
 * stated thing outranks the inferred one. (The classifier is told the same, but a transform
 * that trusts the prompt to have been obeyed is a transform with a silent failure mode.)
 *
 * Exported for tests: the expansion is the part worth pinning, because every wrong beat this
 * transform could produce is a wrong date first.
 */
export function expandSeries(intent: MonthScopedIntent, month: string): DeferredInstance[] {
  // The ordinal is appended AFTER the title is derived, never before — deriveTitle cuts at
  // the first clause separator, and " — 2" is exactly that shape. Composing it here would
  // mean every instance's title collapsed back to the bare series name.
  const subjectFor = (s: string | null | undefined, i: number, total: number): string =>
    (s && s.trim()) ? s.trim() : (total > 1 ? `${deriveTitle(intent.subject)} — ${i + 1}` : intent.subject);

  const listed = intent.instances ?? [];
  if (listed.length > 0) {
    const sorted = [...listed].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((inst, i) => ({
      date: inst.date,
      subject: inst.subject?.trim() ? deriveTitle(inst.subject) : subjectFor(null, i, sorted.length),
    }));
  }

  const rec = intent.recurrence;
  if (!rec) return [];

  // Bound the expansion three ways — count, until, and the month end — and stop at whichever
  // binds first. The month bound is the one that always exists: without it a client saying
  // "every week, ongoing" would expand forever, and a loop whose only limit is the model's
  // honesty is not a loop we should write.
  const monthEnd = clampToMonth(`${month}-31`, month);
  const hardEnd  = rec.until && rec.until < monthEnd ? rec.until : monthEnd;
  const max      = Math.min(rec.count ?? 60, 60);

  const out: DeferredInstance[] = [];
  for (let i = 0, t = parse(rec.startDate); i < max && iso(t) <= hardEnd; i++, t += rec.intervalDays * dayMs) {
    out.push({ date: iso(t), subject: '' });
  }
  // The subject pass runs after expansion so the ordinal reflects the real instance count.
  return out.map((inst, i) => ({ ...inst, subject: subjectFor(null, i, out.length) }));
}

/**
 * Place a series: ONE beat per instance, on the dates the client asked for.
 *
 * The failure this exists for: ivy-t's "one post every 3 weeks" and "every Friday in August"
 * both became launch ARCS — a tease/launch/follow-up compressed into four days — because
 * `launch` was the only intent kind that meant "several posts starting on a date"
 * (docs/reports/ivy-t-rehearsal-failures.md F1). A series is a rhythm, not a moment. It gets
 * no arc, no tease, and no offsets: the dates ARE the instruction.
 *
 * Instances beyond the plan month are NOT placed and NOT discarded — they come back as
 * `deferred` for the caller to file, and the note says so, because a client who asked for a
 * 4 September post deserves better than silence about it.
 */
export function applySeries(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  const all = expandSeries(intent, month);
  if (all.length === 0) {
    return { ops: [], note: 'No dates were given for the series, so there was nothing to place.', unresolved: true };
  }

  const within  = all.filter((i) => inMonth(i.date, month));
  const beyond  = all.filter((i) => !inMonth(i.date, month));
  const deferNote = beyond.length > 0
    ? ` ${beyond.length} post${beyond.length === 1 ? '' : 's'} fall${beyond.length === 1 ? 's' : ''} after this month — saved to your ideas for next time.`
    : '';

  if (within.length === 0) {
    return {
      ops: [], deferred: beyond,
      note: `Every post in ${intent.subject} falls outside this month, so they were saved to your ideas for next time.`,
    };
  }

  // One victim per instance, taken in the order the pool ranks them. Slot count never grows:
  // if the pool runs out we place what we can and say so, rather than overflowing the month.
  const pool = replacementCandidates(beats);
  const ops: BeatOp[] = [];
  const used = new Set<string>();
  const placed: DeferredInstance[] = [];
  const victims: TransformBeat[] = [];

  for (const inst of within) {
    const victim = pool.find((b) => !used.has(b.id));
    if (!victim) break;
    used.add(victim.id);
    victims.push(victim);
    placed.push(inst);
    ops.push({ op: 'remove', id: victim.id });
    ops.push({
      op: 'add',
      date:   inst.date,
      format: victim.format,
      pillar: victim.pillar,
      title:  inst.subject,   // already derived: per-instance subject via deriveTitle below, or the ordinal form
      beatMeta: clientInputMeta(intent.sourceText),
    });
  }

  if (placed.length === 0) {
    return { ops: [], deferred: beyond, note: POOL_EMPTY_NOTE };
  }

  const short = within.length - placed.length;
  const note = short > 0
    ? `Added ${placed.length} of ${within.length} posts for ${intent.subject} — the rest of the month is already spoken for.${deferNote}`
    : (deferNote ? `Added ${placed.length} post${placed.length === 1 ? '' : 's'} for ${intent.subject}.${deferNote}` : undefined);

  // An instance we could not fit is deferred too: it was asked for and it did not land, so
  // it belongs in the backlog with the out-of-month ones rather than vanishing.
  const unplaced = within.slice(placed.length);
  const deferred = [...unplaced, ...beyond];
  const full = [note, displacementNote(victims)].filter(Boolean).join(' ');

  return { ops, ...(full ? { note: full } : {}), ...(deferred.length > 0 ? { deferred } : {}) };
}

// ── Beat spec (a typed calendar row) ────────────────────────────────────────────

/** The formats a beat may take. Format vocab is fixed, not per-client, so the check needs
 *  no config read. */
const BEAT_SPEC_FORMATS = new Set(['reel', 'carousel', 'single']);

/**
 * The month's commonest format as it stands — the honest default for a typed row that gave a
 * date and a title but no format. Ties break reel > carousel > single, a fixed order so the
 * same month always resolves the same way. Undefined only when the month is empty.
 */
function commonestFormat(beats: TransformBeat[]): string | undefined {
  const counts = new Map<string, number>();
  for (const b of beats) if (BEAT_SPEC_FORMATS.has(b.format)) counts.set(b.format, (counts.get(b.format) ?? 0) + 1);
  if (counts.size === 0) return undefined;
  const order = ['reel', 'carousel', 'single'];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0];
}

/**
 * Place a beat the client TYPED as a calendar row.
 *
 * Not a reshape. A typed row is the client's own hand, so it ADDS a slot rather than
 * displacing one — the count grows because they asked for one more post, exactly as the
 * Build B add affordance grows it. There is no pool consulted and nothing is ever replaced.
 *
 * The title is VERBATIM: deriveTitle exists to shorten prose the model echoed into a subject,
 * but a beat_spec title was typed to BE the title, so shortening it would throw away the
 * client's own label. Format is what they named (vocab-checked), else the month's commonest,
 * else `single` as the last-resort floor. No pillar is claimed — they named none, and
 * inventing one would poison the pillar weights the assembler reads. The beat is marked
 * `client_added` and `clientTouched`, the same provenance the manual add carries, so no later
 * transform may quietly take the slot back.
 */
export function applyBeatSpec(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nowhere to place the post.', unresolved: true };
  const title = intent.subject.trim();
  if (!title) return { ops: [], note: 'No title was given for the post.', unresolved: true };

  const date = clampToMonth(intent.dateRange.start, month);
  const named = intent.format && BEAT_SPEC_FORMATS.has(intent.format) ? intent.format : undefined;
  const format = named ?? commonestFormat(beats) ?? 'single';

  const beatMeta: BeatMeta = {
    slotType: 'proven',
    rationaleEvidence: { basis: 'client_added' },
    clientTouched: true,
  };
  return { ops: [{ op: 'add', date, format, pillar: '', title, beatMeta }] };
}

// ── Cadence (a stated posts-per-week / posts-per-month floor) ────────────────────

/** Every ISO date in a plan month, ascending. */
function datesInMonth(month: string): string[] {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Occurrence shares of a field across beats, normalised — the observed weight the month
 *  already carries, reused so a top-up follows the same mix rather than inventing one. */
function distribution(values: string[]): Array<{ name: string; share: number }> {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ name, share: n / total }));
}

/**
 * The `n` thinnest days: fewest beats first, and among those the widest gaps. Deterministic —
 * same month and beats give the same days. A top-up fills the emptiest stretches of the month
 * so the added posts spread the plan out rather than stacking onto days that already have one.
 */
function thinnestDays(month: string, beats: TransformBeat[], n: number): string[] {
  const dates = datesInMonth(month);
  const idx   = new Map(dates.map((d, i) => [d, i]));
  const count = new Map<string, number>(dates.map((d) => [d, 0]));
  for (const b of beats) if (count.has(b.date)) count.set(b.date, count.get(b.date)! + 1);

  const chosen: string[] = [];
  for (let k = 0; k < n; k++) {
    let best = dates[0]!;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (const d of dates) {
      const c = count.get(d)!;
      let dist = dates.length;              // distance to the nearest OCCUPIED day
      for (const [e, ec] of count) if (ec > 0 && e !== d) dist = Math.min(dist, Math.abs(idx.get(e)! - idx.get(d)!));
      const key: [number, number] = [c, -dist];   // fewest beats, then widest gap
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { bestKey = key; best = d; }
    }
    count.set(best, count.get(best)! + 1);
    chosen.push(best);
  }
  return chosen.sort();
}

/** Say the target back the way the client stated it — the receipt quotes their own units. */
function describeCadence(intent: MonthScopedIntent): string {
  if (typeof intent.postsPerWeek === 'number')  return `${intent.postsPerWeek} a week`;
  if (typeof intent.postsPerMonth === 'number') return `${intent.postsPerMonth} this month`;
  return 'your cadence';
}

/**
 * Apply a stated cadence FLOOR to the month.
 *
 * A floor — never a target, never a cap. When the client asks for MORE than the month holds,
 * top it up now: place the gap's worth of beats on the thinnest days, taking format and pillar
 * from the mix the month already shows (its observed weights) and carrying the real observed
 * engagement for each format where the month has one — copied from a live beat, never invented.
 * Every added beat is the client's input, quoted.
 *
 * Nothing is ever removed. A cadence that is a DECREASE, or one already met, adds nothing and
 * says so — the floor is recorded for future assembly, and the client is left to drop what they
 * don't want, because removing their posts for them is not ours to do.
 */
export function applyCadence(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  const floor  = cadenceFloorSlots(month, intent);
  const have   = beats.length;
  const gap    = floor - have;
  const target = describeCadence(intent);

  if (gap <= 0) {
    return {
      ops: [],
      note: `Recorded ${target} as your floor. You have ${have} post${have === 1 ? '' : 's'} this month — I only ever add to reach a floor, never remove, so drop the ones you don’t want.`,
    };
  }

  const days    = thinnestDays(month, beats, gap);
  const formats = spreadPillars(distribution(beats.map((b) => b.format)), gap);
  const pillars = spreadPillars(distribution(beats.map((b) => b.pillar)), gap);

  const feByFormat = new Map<string, BeatRationaleEvidence['formatEngagement']>();
  for (const b of beats) {
    const fe = b.beatMeta?.rationaleEvidence?.formatEngagement;
    if (fe && !feByFormat.has(fe.format)) feByFormat.set(fe.format, fe);
  }

  const ops: BeatOp[] = days.map((date, i) => {
    const format = formats[i] ?? commonestFormat(beats) ?? 'single';
    const pillar = pillars[i] ?? '';
    const fe = feByFormat.get(format);
    const beatMeta: BeatMeta = {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'client_input',
        reason: intent.sourceText,
        ...(fe ? { formatEngagement: fe } : {}),
      } as BeatMeta['rationaleEvidence'],
    };
    const label = `${format.charAt(0).toUpperCase()}${format.slice(1)}`;
    return { op: 'add', date, format, pillar, title: pillar ? `${pillar} — ${label}` : label, beatMeta };
  });

  return { ops, note: `Added ${gap} post${gap === 1 ? '' : 's'} to reach ${target}, as you asked.` };
}

/** A single dated beat, same replacement rule. */
export function applyEvent(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nowhere to put it.', unresolved: true };
  const date = clampToMonth(intent.dateRange.start, month);

  const victim = replacementCandidates(beats, date)[0];
  if (!victim) return { ops: [], note: POOL_EMPTY_NOTE };

  const displaced = displacementNote([victim]);
  return {
    ops: [
      { op: 'remove', id: victim.id },
      { op: 'add', date, format: victim.format, pillar: victim.pillar, title: deriveTitle(intent.subject), beatMeta: clientInputMeta(intent.sourceText) },
    ],
    ...(displaced ? { note: displaced } : {}),
  };
}

/**
 * ── WHAT AN EMPHASIS PHRASE NAMES ────────────────────────────────────────────────────
 *
 * The emphasis field is *the pillar or format to weight up* — that is what the classifier's
 * prompt asks the model for. It was then tested for case-insensitive EQUALITY against a
 * pillar name, and whatever the client said was written into the `pillar` column verbatim.
 *
 * Those two facts do not sit together. A phrase that does not exactly equal a pillar name
 * matched nothing, and "matched nothing" was not a no-op: the eligibility filter reads
 * `b.pillar !== target`, so a non-matching target is unequal to EVERY pillar, every future
 * untouched beat becomes eligible, and a third of the month is re-pillared to the raw
 * phrase. Missing the target was the maximum-damage case, not the safe one.
 *
 * The only thing standing in the way was the 120-character cap on the field
 * (`intake-classify.ts`), which rejected the sentences before they ever reached here — a
 * guard doing a matcher's job, and the reason the corpus contains no `emphasis_reweight`
 * beat and no "Leaned…" receipt. Nothing has to be migrated because nothing has happened.
 *
 * So the match is made to do what the field is for. Word overlap against the month's own
 * pillar names, and the CANONICAL name is what gets written — never the client's phrase.
 *
 * ── The vocabulary is the CLIENT'S, not just the month's ─────────────────────────────
 *
 * "more product this month" is most likely to be said about a month with no product in it,
 * so matching against the pillars the month already carries would fail exactly when the
 * client needs it. The authority on what this client's pillars ARE is
 * `client_planning_config.pillars` — the same list `addBeat` validates against, and for the
 * same reason: free text in the pillar column poisons the weights the assembler reads.
 *
 * So the caller passes it in, and it is UNIONED with the month's own pillars: a config that
 * changed after the month was drafted must not make the month's existing pillars
 * unnameable. When no vocabulary is supplied the union degrades to the month's own pillars
 * — narrower, still correct, and never the raw phrase.
 */
const EMPHASIS_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from',
  'my', 'our', 'your', 'their', 'its', 'this', 'that', 'these', 'those', 'it', 'we', 'i', 'you',
  'is', 'are', 'be', 'do', 'doing', 'please', 'more', 'less', 'some', 'any', 'all', 'bit', 'lot',
]);

/** Whole words, lowercased, '&' read as "and", punctuation dropped, function words removed.
 *  Applied identically to the client's phrase and to a pillar name — an asymmetric
 *  normalisation would make the match depend on which side a word happened to sit. */
function emphasisWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !EMPHASIS_STOPWORDS.has(w)),
  );
}

/**
 * What an emphasis INTENT names — `resolveEmphasisTarget` applied to the intent's fields in the
 * order that survives a bad extraction.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────
 *
 * The classifier puts the QUANTIFIER in `emphasis` and the TOPIC in `subject`. Measured live,
 * 5 runs each: "can we lean into the morning routine more" → emphasis "more", subject "morning
 * routine"; "can we do more reels this month" → emphasis "more"/"increase", subject "more
 * reels". And `more` is in EMPHASIS_STOPWORDS, so it normalises to the empty set and can match
 * no pillar and no format — the client names a pillar and the month does not move.
 *
 * `applyEmphasis` already tried to cover this with `intent.emphasis ?? intent.subject`. `??`
 * guards against ABSENT, not against MEANINGLESS: "more" is present, so the fallback never
 * fired. A value can satisfy a schema, satisfy a null check, and still carry nothing.
 *
 * ── WHY IT IS ITS OWN FUNCTION, AND NOT THE TWO OBVIOUS PLACES ───────────────────────
 *
 * Not inside `resolveEmphasisTarget`, which answers "what does THIS PHRASE name". Giving it an
 * intent would change that question to "what does this INTENT name" and put intent-shape
 * knowledge inside a string matcher, whose twelve tests all read as phrase-level facts.
 *
 * Not inlined in `applyEmphasis` either, and this is the reason that matters: the scope-eval
 * harness has to assert what PRODUCTION resolves, and a harness that reimplements the rule it
 * is checking checks nothing. Inlined, the corpus would have had to copy this loop. Named, it
 * calls it. The blind spot the corpus had — asserting scope and kind but never a field's VALUE
 * — is closed by asserting through this function, so this function has to be reachable.
 *
 * ── THE ORDER, AND THE FILTER BEFORE IT ──────────────────────────────────────────────
 *
 * `emphasis` is still tried FIRST. When the model writes a real instruction there it is the
 * better phrase, and the back-to-school brief — 124 characters of what the captions should say
 * — still wins on its own merits. Only when it names nothing does `subject` get a turn.
 *
 * Candidates with NO significant words are dropped before any of that. "more" can only ever
 * return `none`, so trying it wastes nothing — but it would then be quoted back to the client
 * in the receipt as *Noted for this month: "more"*, and that is the sentence this whole path
 * exists to avoid. The test is `emphasisWords`, the same normalisation the matcher uses, so a
 * word is "insignificant" here for exactly the reason it cannot match there.
 *
 * `ambiguous` STOPS the search. It is a real match against two pillars, and falling through to
 * `subject` would silently resolve an ambiguity that belongs to the client.
 */
export function resolveEmphasisIntent(
  intent: Pick<MonthScopedIntent, 'emphasis' | 'subject'>,
  pillars: readonly string[],
): { target: EmphasisTarget; phrase: string } {
  const candidates = [intent.emphasis, intent.subject]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0 && emphasisWords(s).size > 0);

  if (candidates.length === 0) return { target: { kind: 'none', candidates: [] }, phrase: '' };

  for (const phrase of candidates) {
    const target = resolveEmphasisTarget(phrase, pillars);
    if (target.kind !== 'none') return { target, phrase };
  }
  // Nothing named a pillar or a format. That is a legitimate answer — the caller keeps the
  // sentence as month context — and the phrase it quotes is the first candidate, which is the
  // client's own instruction when they gave one and their topic when they did not.
  return { target: resolveEmphasisTarget(candidates[0]!, pillars), phrase: candidates[0]! };
}

/** The format families a phrase can name, so "more reels" and "more video" both land. */
const FORMAT_WORDS: Record<string, string> = {
  reel: 'reel', reels: 'reel', video: 'reel', videos: 'reel',
  carousel: 'carousel', carousels: 'carousel', gallery: 'carousel',
  single: 'single', singles: 'single', photo: 'single', photos: 'single',
  image: 'single', images: 'single', picture: 'single', pictures: 'single',
};

export type EmphasisTarget =
  | { kind: 'pillar'; name: string }
  | { kind: 'format'; name: string }
  | { kind: 'none';   candidates: string[] }
  /** Two or more pillars fit equally well. Naming them is more useful than picking one. */
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Which pillar or format is this phrase asking for?
 *
 * PILLAR FIRST, then format. A phrase naming both ("more product reels") is answered with
 * the pillar because that is the richer of the two asks and the cheaper one to be wrong
 * about — a re-pillar is visible on the card, a format swap changes what has to be shot.
 *
 * A pillar wins on the COUNT of its own words the phrase supplies, and it must win outright:
 * "more real content" supplies one word each to *Born From Real Need* and *Understands Real
 * Women*, and picking either would be a guess. Ties return `ambiguous` and change nothing.
 *
 * Exported because this is the rule the whole transform now turns on, and a rule only
 * observable through a database and a model call is a rule nobody will check.
 */
export function resolveEmphasisTarget(phrase: string, pillars: readonly string[]): EmphasisTarget {
  const said = emphasisWords(phrase);
  const names = [...new Set(pillars.map((p) => p.trim()).filter(Boolean))].sort();

  let best = 0;
  let winners: string[] = [];
  for (const name of names) {
    const hits = [...emphasisWords(name)].filter((w) => said.has(w)).length;
    if (hits === 0 || hits < best) continue;
    if (hits > best) { best = hits; winners = [name]; } else winners.push(name);
  }
  if (winners.length === 1) return { kind: 'pillar', name: winners[0]! };
  if (winners.length > 1)   return { kind: 'ambiguous', candidates: winners };

  const formats = [...new Set([...said].map((w) => FORMAT_WORDS[w]).filter((f): f is string => !!f))];
  if (formats.length === 1) return { kind: 'format', name: formats[0]! };

  return { kind: 'none', candidates: names };
}

/** The month's pillars, in a sentence — what the client can actually ask for. */
const listPillars = (names: readonly string[]): string =>
  names.length === 0 ? ''
  : names.length === 1 ? names[0]!
  : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

/**
 * Reweight the rest of the month toward a pillar or format.
 *
 * Only FUTURE, untouched, non-client beats are eligible — a past-dated beat cannot be
 * changed and a beat the client edited must not be. Converts up to a third of the eligible
 * beats, so an emphasis tilts the month rather than replacing it: "more product" does not
 * mean "only product", and reading it that way would be a worse answer than doing nothing.
 *
 * A phrase that names nothing changes NOTHING, and says so. Returning `{ops: []}` is not a
 * dead end: `draft-apply.ts` files a no-op month-scoped intent to the backlog with
 * `reason: 'not_applicable'`, carries this note onto the receipt, and attaches the
 * `planInputId` that powers the "add it to this month" tap. So the client's words are kept,
 * the reason is on screen, and there is a way forward — without a single beat being touched.
 */
export function applyEmphasis(
  intent: MonthScopedIntent, beats: TransformBeat[], today: string,
  /** The client's configured pillar names. Unioned with the month's own — see above. */
  clientPillars: readonly string[] = [],
): TransformResult {
  const monthPillars = [...new Set([
    ...clientPillars.map((p) => p.trim()),
    ...beats.map((b) => b.pillar.trim()),
  ].filter(Boolean))].sort();

  const { target: resolved, phrase } = resolveEmphasisIntent(intent, monthPillars);
  if (!phrase) return { ops: [], note: 'It wasn’t clear what to lean into, so nothing changed.', unresolved: true };

  if (resolved.kind === 'ambiguous') {
    return { ops: [], note: `“${phrase}” could mean ${listPillars(resolved.candidates)} — which did you mean? Nothing has changed.`, unresolved: true };
  }
  if (resolved.kind === 'none') {
    /**
     * NOT re-pillared to the phrase — that is what used to happen here, and it is what the
     * 120-character cap was quietly preventing.
     *
     * But "names no pillar" is not "means nothing". *"the back to school element should talk
     * about the juggle of the school run and working life"* is exactly what the client wants
     * this month's captions to be about; it simply names no beat and no date, so there is
     * nothing to move and nothing to place. It is returned as CONTEXT: the shape of the month
     * is untouched, and the caller keeps the sentence where generation will read it.
     *
     * The client is told that, rather than told we failed. The pillar list stays in the copy
     * because naming one is still the way to make the month VISIBLY tilt, and that is a real
     * second option rather than a consolation.
     */
    return {
      ops: [],
      context: intent.sourceText.trim() || phrase,
      note: monthPillars.length
        ? `Noted for this month: “${phrase}”. I’ve kept it with the month’s brief, so it’s there when the captions are written. It doesn’t name one of your content pillars, so nothing on the calendar has moved — say ${listPillars(monthPillars)}, or a format (reel, carousel or single image), if you want the month to lean that way too.`
        : `Noted for this month: “${phrase}”. I’ve kept it with the month’s brief, so it’s there when the captions are written. Nothing on the calendar has moved.`,
    };
  }

  const asFormat = resolved.kind === 'format' ? resolved.name : null;
  /** The CANONICAL pillar name, never the client's phrase — the whole point of the match. */
  const asPillar = resolved.kind === 'pillar' ? resolved.name : null;
  const label = resolved.name;

  const eligible = beats
    .filter((b) => b.date >= today)               // past beats are not ours to change
    // Tiers 0-1 ONLY. An emphasis is a tilt, not a request for a specific post, so it must
    // not re-pillar a beat an earlier sentence asked for by name — displacing one to make
    // room for a NEW named ask is defensible; quietly rewriting what it is about is not.
    .filter((b) => { const t = replacementTier(b); return t === 0 || t === 1; })
    // Skip what is already leaning that way. This line used to double as the match test,
    // which is why a phrase matching nothing selected everything.
    .filter((b) => (asFormat ? b.format !== asFormat : b.pillar.trim().toLowerCase() !== asPillar!.toLowerCase()))
    .sort(byWeakestEvidence);

  if (eligible.length === 0) {
    return { ops: [], note: `The rest of the month is already yours or already leaning toward ${label}.` };
  }

  const convert = Math.max(1, Math.floor(eligible.length / 3));
  const ops: BeatOp[] = eligible.slice(0, convert).map((b) => (
    asFormat
      // A format swap leaves the beat's PILLAR evidence true — the pillar share it cites
      // is still the pillar it has — so the evidence stands. Only formatEngagement would
      // now be stale, and it is dropped with the rest of the observed evidence below only
      // when the pillar itself changes.
      ? { op: 'update' as const, id: b.id, changes: { format: asFormat }, beatMeta: reweighted(b, intent.sourceText) }
      // A RE-PILLAR invalidates the evidence outright: the beat would otherwise keep
      // citing "Everyday Ritual is 20% of what you post" while sitting under Product &
      // Fragrance. Stale metrics from the old pillar must never survive the move, so the
      // evidence is REPLACED with the honest one: you asked for this.
      : { op: 'update' as const, id: b.id, changes: { pillar: asPillar! }, beatMeta: reweighted(b, intent.sourceText) }
  ));
  return { ops, note: `Leaned ${convert} post${convert === 1 ? '' : 's'} toward ${label}.` };
}

/**
 * Resolve "the Friday reel" to an actual beat and apply a Build B mutation to it.
 *
 * Resolution must be UNAMBIGUOUS. If the reference matches zero beats or more than one,
 * the caller routes the input to the backlog with a receipt instead of picking one —
 * changing the wrong post is worse than not changing a post.
 *
 * ── THERE IS A SECOND DATE READER IN THIS FILE. READ BOTH TOGETHER ──────────────────
 *
 * `beatsOnNamedDate` is the correction path's, and it is deliberately STRICTER: it requires an
 * ordinal suffix on a bare day where this one does not. The difference is the caller's guard,
 * not an oversight — `applyBeatEdit` refuses ambiguity, `applyCorrection` moves every match, so
 * a loose reader is safe here and is not there. Change one and check the other.
 */
export function resolveBeatRef(ref: string, beats: TransformBeat[]): TransformBeat[] {
  const needle = ref.toLowerCase().trim();
  if (!needle) return [];

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIdx = DAYS.findIndex((d) => needle.includes(d));
  const format = ['reel', 'carousel', 'single'].find((f) => needle.includes(f));
  const dayMatch = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(needle);

  return beats.filter((b) => {
    if (dayIdx >= 0 && new Date(`${b.date}T00:00:00Z`).getUTCDay() !== dayIdx) return false;
    if (format && b.format !== format) return false;
    if (dayMatch && Number(b.date.slice(8, 10)) !== Number(dayMatch[1])) return false;
    // A bare reference with no day, format or date matches nothing — we will not guess.
    if (dayIdx < 0 && !format && !dayMatch) return needle.length > 3 && b.title.toLowerCase().includes(needle);
    return true;
  });
}

export function applyBeatEdit(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.beatRef || !intent.edit) return { ops: [], note: 'It wasn’t clear which post you meant.', unresolved: true };

  const matches = resolveBeatRef(intent.beatRef, beats);
  if (matches.length === 0) return { ops: [], note: `We couldn’t find “${intent.beatRef}” in this month.`, unresolved: true };
  if (matches.length > 1)  return { ops: [], note: `“${intent.beatRef}” could be ${matches.length} different posts, so nothing was changed.`, unresolved: true };

  const beat = matches[0]!;
  switch (intent.edit) {
    case 'drop':
      return { ops: [{ op: 'remove', id: beat.id }] };
    case 'swap_format': {
      const fmt = (intent.editValue ?? '').toLowerCase();
      if (!['reel', 'carousel', 'single'].includes(fmt)) return { ops: [], note: 'That isn’t a format we can plan for.', unresolved: true };
      return { ops: [{ op: 'update', id: beat.id, changes: { format: fmt } }] };
    }
    case 'move': {
      const to = (intent.editValue ?? intent.dateRange?.start ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ops: [], note: 'It wasn’t clear what date to move it to.', unresolved: true };
      return { ops: [{ op: 'update', id: beat.id, changes: { date: clampToMonth(to, month) } }] };
    }
    default:
      return { ops: [] };
  }
}


/**
 * Match beats by SUBJECT, for a correction.
 *
 * Distinct from resolveBeatRef, which identifies one post by day/format/date. A correction
 * names a thing — "the Meadow candle launch" — and that thing may be a whole arc. Matching
 * looks at the beat's title AND at the words that created it (beat_meta evidence `reason`,
 * which applyLaunchArc/applyEvent write verbatim from the client's own message), so a
 * correction can find beats whose titles were phrased by the assembler rather than typed.
 */
export function resolveBeatSubject(subject: string, beats: TransformBeat[]): TransformBeat[] {
  const words = subject.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  if (words.length === 0) return [];

  const haystack = (b: TransformBeat): string => {
    const reason = (b.beatMeta?.rationaleEvidence as { reason?: unknown } | undefined)?.reason;
    return `${b.title} ${typeof reason === 'string' ? reason : ''}`.toLowerCase();
  };
  // Every significant word must appear. "meadow candle" must not match a wilderness beat
  // just because both say "candle".
  return beats.filter((b) => { const h = haystack(b); return words.every((w) => h.includes(w)); });
}

/** Month names as a client writes them, and their numbers. Only used to CHECK a named month
 *  against a beat's own — never to guess one. */
const MONTH_WORD = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?'
  + '|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** 'YYYY-MM-DD', anywhere in the phrase. */
const ISO_IN = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/** A day that CARRIES ITS ORDINAL SUFFIX, with an optional month after it: "the 22nd", "22nd Sep". */
const ORDINAL_IN = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)\\b(?:\\s+(?:of\\s+)?(${MONTH_WORD})\\b)?`, 'i');
/** A month leading its day, where the suffix is redundant: "September 22", "Sep 22nd". */
const MONTH_DAY_IN = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');

/**
 * The beats sitting on the date a phrase NAMES — the correction path's fallback resolver.
 *
 * ── A BARE NUMBER IS NEVER A DATE HERE, AND THAT IS DELIBERATE ──────────────────────
 *
 * `resolveBeatRef` reads `/\b(\d{1,2})(?:st|nd|rd|th)?\b/` — the suffix optional — and it can
 * afford to, because `applyBeatEdit` REFUSES on zero or more than one match. `applyCorrection`
 * has no such guard: it moves every beat it matched. So a reader that turned "the top 5 tips
 * post" into "whatever is on the 5th" would silently reschedule an unrelated post out of a
 * sentence that named no date at all.
 *
 * The suffix is therefore REQUIRED for a bare day. "22 September" is not accepted and "the 22nd"
 * is; "September 22" is, because a month leading its day is unambiguous without one. That costs
 * the unsuffixed "move 22 September to the 25th" and it is the right side to fail on. DO NOT
 * "improve" this by making the suffix optional — `draft-corrections.test.ts` pins the bare-digit
 * case for that reason.
 *
 * A NAMED month is checked against the beat's own, so "the 22nd of October" finds nothing in a
 * September plan rather than moving September's 22nd.
 *
 * ── WHY THIS IS NOT SHARED WITH `resolveBeatRef` ─────────────────────────────────────
 *
 * Two readers, two callers, two different guarantees — and the divergence is recorded here
 * rather than carried in somebody's head. `resolveBeatRef` identifies ONE post and its caller
 * refuses ambiguity; this one may legitimately return several (a date holding two posts) and
 * its caller moves them together. Collapsing them would mean picking one of those two
 * semantics for both, which is a change to what `move the Meadow launch` does — a redesign of
 * the intent taxonomy, not this fix. If either reader is changed, read the other.
 */
export function beatsOnNamedDate(ref: string, beats: TransformBeat[]): TransformBeat[] {
  const t = (ref ?? '').trim();
  if (!t) return [];

  const iso = ISO_IN.exec(t);
  if (iso) return beats.filter((b) => b.date === `${iso[1]}-${iso[2]}-${iso[3]}`);

  const monthOf = (word: string | undefined): number | null =>
    word ? MONTH_NUM[word.slice(0, 3).toLowerCase()] ?? null : null;

  const ord = ORDINAL_IN.exec(t);
  const md = ord ? null : MONTH_DAY_IN.exec(t);
  const day = ord ? Number(ord[1]) : md ? Number(md[2]) : null;
  const month = ord ? monthOf(ord[2]) : md ? monthOf(md[1]) : null;
  if (day === null || day < 1 || day > 31) return [];

  return beats.filter((b) =>
    Number(b.date.slice(8, 10)) === day && (month === null || Number(b.date.slice(5, 7)) === month));
}

/**
 * Apply a correction: move (or reformat) what is already on the plan.
 *
 * The uat failure this exists for: a client wrote "Meadow candle launch is the 10th not the
 * 1st" twice, and both times it was classified evergreen and filed as an idea — the month
 * never changed and nothing said so (docs/reports/wrong-month-generated.md §6).
 *
 * RELATIVE SPACING IS PRESERVED. A launch is three beats at fixed offsets; moving the
 * launch must move the tease and follow-up with it, or the correction fixes one date and
 * silently breaks two. Offsets are measured from the EARLIEST matched beat and re-applied
 * from the new anchor, then clamped into the month.
 *
 * No match on the plan → no ops, and the caller files it as evergreen exactly as today.
 * A correction that names something we cannot find is not a licence to invent a beat.
 */
export function applyCorrection(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  const subject = intent.correctionOf ?? intent.subject;
  /**
   * ── SUBJECT FIRST, THEN THE DATE ────────────────────────────────────────────────────
   *
   * "can we move the 22nd to the 25th?" came back *"We couldn't find 'the 22nd' on this
   * month's plan, so it was saved to your ideas instead"* over a September holding a post on
   * the 22nd. `resolveBeatSubject` searches `title + rationale reason` and no date in any
   * form, so a bare ordinal could never match it — while `resolveBeatRef`, forty lines above,
   * has read dates since it was written. Which resolver ran was decided by whether the model
   * said `correction` or `beat_edit`, a choice the client cannot see, and CLASSIFY_SYSTEM
   * steers "move …" to `correction`. Referring to a post by its date is the most ordinary
   * thing a client does here, so it must work either way.
   *
   * The ORDER is the whole safety argument. Subject matching runs first and unchanged, so
   * every correction that resolves today resolves identically — this cannot reroute a working
   * case, only rescue one that is currently filed as an idea. Date-first would hijack exactly
   * the sentence this function exists for: "the Meadow candle launch is the 10th not the 1st"
   * would resolve on the OLD date and move whatever sits there instead of the arc.
   */
  const matches = resolveBeatSubject(subject, beats).length
    ? resolveBeatSubject(subject, beats)
    : beatsOnNamedDate(subject, beats);
  if (matches.length === 0) {
    return { ops: [], note: `We couldn’t find “${subject}” on this month’s plan, so it was saved to your ideas instead.`, unresolved: true };
  }

  // A format correction applies to every matched beat of a launch? No — a format change is
  // about ONE post, so it needs an unambiguous match.
  if (intent.edit === 'swap_format' || intent.editValue) {
    const fmt = (intent.editValue ?? '').toLowerCase();
    if (['reel', 'carousel', 'single'].includes(fmt)) {
      if (matches.length > 1) {
        return { ops: [], note: `“${subject}” is ${matches.length} posts this month, so it wasn’t clear which one to change the format of.`, unresolved: true };
      }
      return { ops: [{ op: 'update', id: matches[0]!.id, changes: { format: fmt } }] };
    }
  }

  const to = intent.dateRange?.start;
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ops: [], note: `It wasn’t clear what to change about “${subject}”, so it was saved to your ideas.`, unresolved: true };
  }

  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));
  const anchor = parse(sorted[0]!.date);
  const ops: BeatOp[] = sorted.map((b) => ({
    op: 'update' as const,
    id: b.id,
    changes: { date: clampToMonth(iso(parse(to) + (parse(b.date) - anchor)), month) },
  }));

  return sorted.length > 1
    ? { ops, note: `Moved all ${sorted.length} posts for “${subject}”, keeping the same spacing.` }
    : { ops };
}

/** Dispatch an intent to its transform. */
export function applyIntent(
  intent: MonthScopedIntent, beats: TransformBeat[], month: string, today: string,
  /** The client's configured pillar names — the emphasis branch's vocabulary. Optional so
   *  every other kind's callers are unchanged; omitting it narrows an emphasis match to the
   *  month's own pillars rather than widening it to anything (`applyEmphasis`). */
  clientPillars: readonly string[] = [],
  /** The extractor's own dates for this intent's subject (brief-schedule.ts). Only the launch
   *  arc reads them; every other kind ignores the argument entirely. */
  given: BriefArcDates = {},
): TransformResult {
  switch (intent.kind) {
    case 'launch':    return applyLaunchArc(intent, beats, month, given);
    case 'event':     return applyEvent(intent, beats, month);
    case 'series':    return applySeries(intent, beats, month);
    case 'beat_spec': return applyBeatSpec(intent, beats, month);
    case 'cadence':   return applyCadence(intent, beats, month);
    case 'emphasis':  return applyEmphasis(intent, beats, today, clientPillars);
    case 'beat_edit': return applyBeatEdit(intent, beats, month);
    case 'correction':return applyCorrection(intent, beats, month);
    default:          return { ops: [] };
  }
}
