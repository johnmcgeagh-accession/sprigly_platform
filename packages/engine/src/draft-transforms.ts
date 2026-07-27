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
import type { BeatMeta } from '@sprigly/db';
import type { MonthScopedIntent } from './intake-classify.js';

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
  /** Why nothing (or less than asked) happened. Surfaced to the client, never swallowed. */
  note?: string;
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
  if (!cleaned) return 'Untitled beat';

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

/**
 * Allocate a launch arc around the stated date, replacing the weakest beats to make room.
 *
 * Places all three parts it can. If only two slots are replaceable it places two and SAYS
 * so — a partial arc the client can see is better than a full arc that quietly evicted a
 * beat they cared about, and better than silence.
 */
export function applyLaunchArc(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nothing to build the launch around.' };
  const anchor = intent.dateRange.start;

  const pool = replacementCandidates(beats, anchor);
  if (pool.length === 0) return { ops: [], note: POOL_EMPTY_NOTE };

  const { parts, dropped } = arcDates(anchor, month);

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
 */
function arcDates(anchor: string, month: string): {
  parts: Array<{ date: string; label: string; format: string }>;
  dropped?: string;
} {
  const first = clampToMonth(`${month}-01`, month);
  const last  = clampToMonth(`${month}-31`, month);
  const at = (offset: number) => clampToMonth(iso(parse(anchor) + offset * dayMs), month);

  const launchDate = at(0);
  const parts: Array<{ date: string; label: string; format: string }> = [];
  const notes: string[] = [];

  // Tease — must land strictly BEFORE the launch.
  const teasePart = LAUNCH_ARC[0]!;
  const teaseWanted = at(teasePart.offsetDays);
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
  const followWanted = at(followPart.offsetDays);
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
    return { ops: [], note: 'No dates were given for the series, so there was nothing to place.' };
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
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nowhere to place the post.' };
  const title = intent.subject.trim();
  if (!title) return { ops: [], note: 'No title was given for the post.' };

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

/** A single dated beat, same replacement rule. */
export function applyEvent(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nowhere to put it.' };
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
 * Reweight the rest of the month toward a pillar or format.
 *
 * Only FUTURE, untouched, non-client beats are eligible — a past-dated beat cannot be
 * changed and a beat the client edited must not be. Converts up to a third of the eligible
 * beats, so an emphasis tilts the month rather than replacing it: "more product" does not
 * mean "only product", and reading it that way would be a worse answer than doing nothing.
 */
export function applyEmphasis(
  intent: MonthScopedIntent, beats: TransformBeat[], today: string,
): TransformResult {
  const target = (intent.emphasis ?? intent.subject).trim();
  if (!target) return { ops: [], note: 'It wasn’t clear what to lean into, so nothing changed.' };

  const FORMATS = new Set(['reel', 'carousel', 'single']);
  const asFormat = FORMATS.has(target.toLowerCase()) ? target.toLowerCase() : null;

  const eligible = beats
    .filter((b) => b.date >= today)               // past beats are not ours to change
    // Tiers 0-1 ONLY. An emphasis is a tilt, not a request for a specific post, so it must
    // not re-pillar a beat an earlier sentence asked for by name — displacing one to make
    // room for a NEW named ask is defensible; quietly rewriting what it is about is not.
    .filter((b) => { const t = replacementTier(b); return t === 0 || t === 1; })
    .filter((b) => (asFormat ? b.format !== asFormat : b.pillar.toLowerCase() !== target.toLowerCase()))
    .sort(byWeakestEvidence);

  if (eligible.length === 0) {
    return { ops: [], note: `The rest of ${target ? 'the month' : 'it'} is already yours or already leaning that way.` };
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
      : { op: 'update' as const, id: b.id, changes: { pillar: target }, beatMeta: reweighted(b, intent.sourceText) }
  ));
  return { ops, note: `Leaned ${convert} post${convert === 1 ? '' : 's'} toward ${target}.` };
}

/**
 * Resolve "the Friday reel" to an actual beat and apply a Build B mutation to it.
 *
 * Resolution must be UNAMBIGUOUS. If the reference matches zero beats or more than one,
 * the caller routes the input to the backlog with a receipt instead of picking one —
 * changing the wrong post is worse than not changing a post.
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
  if (!intent.beatRef || !intent.edit) return { ops: [], note: 'It wasn’t clear which post you meant.' };

  const matches = resolveBeatRef(intent.beatRef, beats);
  if (matches.length === 0) return { ops: [], note: `We couldn’t find “${intent.beatRef}” in this month.` };
  if (matches.length > 1)  return { ops: [], note: `“${intent.beatRef}” could be ${matches.length} different posts, so nothing was changed.` };

  const beat = matches[0]!;
  switch (intent.edit) {
    case 'drop':
      return { ops: [{ op: 'remove', id: beat.id }] };
    case 'swap_format': {
      const fmt = (intent.editValue ?? '').toLowerCase();
      if (!['reel', 'carousel', 'single'].includes(fmt)) return { ops: [], note: 'That isn’t a format we can plan for.' };
      return { ops: [{ op: 'update', id: beat.id, changes: { format: fmt } }] };
    }
    case 'move': {
      const to = (intent.editValue ?? intent.dateRange?.start ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ops: [], note: 'It wasn’t clear what date to move it to.' };
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
  const matches = resolveBeatSubject(subject, beats);
  if (matches.length === 0) {
    return { ops: [], note: `We couldn’t find “${subject}” on this month’s plan, so it was saved to your ideas instead.` };
  }

  // A format correction applies to every matched beat of a launch? No — a format change is
  // about ONE post, so it needs an unambiguous match.
  if (intent.edit === 'swap_format' || intent.editValue) {
    const fmt = (intent.editValue ?? '').toLowerCase();
    if (['reel', 'carousel', 'single'].includes(fmt)) {
      if (matches.length > 1) {
        return { ops: [], note: `“${subject}” is ${matches.length} posts this month, so it wasn’t clear which one to change the format of.` };
      }
      return { ops: [{ op: 'update', id: matches[0]!.id, changes: { format: fmt } }] };
    }
  }

  const to = intent.dateRange?.start;
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ops: [], note: `It wasn’t clear what to change about “${subject}”, so it was saved to your ideas.` };
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
): TransformResult {
  switch (intent.kind) {
    case 'launch':    return applyLaunchArc(intent, beats, month);
    case 'event':     return applyEvent(intent, beats, month);
    case 'series':    return applySeries(intent, beats, month);
    case 'beat_spec': return applyBeatSpec(intent, beats, month);
    case 'emphasis':  return applyEmphasis(intent, beats, today);
    case 'beat_edit': return applyBeatEdit(intent, beats, month);
    case 'correction':return applyCorrection(intent, beats, month);
    default:          return { ops: [] };
  }
}
