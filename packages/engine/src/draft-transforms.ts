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
 * is the LOWEST-EVIDENCE beat, in this order:
 *   1. template-basis beats   — we had no history to justify these at all
 *   2. observed beats, weakest evidence first (smallest n, then lowest engagement)
 * and NEVER:
 *   - a beat the client has touched (beat_meta.clientTouched) — their hand outranks the
 *     algorithm, always
 *   - an experiment beat sourced from a client idea — they asked for that specifically
 *   - a beat already added by a previous client input this cycle
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

export interface TransformResult {
  ops: BeatOp[];
  /** Why nothing (or less than asked) happened. Surfaced to the client, never swallowed. */
  note?: string;
}

// ── Protection and ranking ────────────────────────────────────────────────────

/** Has the client's own hand been on this beat? Set by the Build B mutations. */
export function isClientTouched(beat: TransformBeat): boolean {
  return (beat.beatMeta as { clientTouched?: unknown } | null)?.clientTouched === true;
}

/** An experiment the client asked for, or a beat a previous input of theirs created. */
export function isClientOriginated(beat: TransformBeat): boolean {
  const meta = beat.beatMeta;
  if (!meta) return false;
  const basis = meta.rationaleEvidence?.basis;
  if (basis === 'client_added' || basis === 'client_input') return true;
  return meta.slotType === 'experiment' && meta.rationaleEvidence?.candidateRank?.origin === 'client';
}

/** May this beat be replaced to make room for something the client asked for? */
export function isReplaceable(beat: TransformBeat): boolean {
  return !isClientTouched(beat) && !isClientOriginated(beat);
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

/** Replacement candidates, weakest first, optionally preferring beats near a date. */
export function replacementCandidates(beats: TransformBeat[], nearDate?: string): TransformBeat[] {
  const pool = beats.filter(isReplaceable).sort(byWeakestEvidence);
  if (!nearDate) return pool;
  // Among equally weak beats, take the one nearest the client's date — a launch tease
  // should displace something that week, not something three weeks away.
  const dist = (d: string) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${nearDate}T00:00:00Z`));
  return pool.sort((a, b) => byWeakestEvidence(a, b) || dist(a.date) - dist(b.date));
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
  if (pool.length === 0) {
    return { ops: [], note: `Every beat this month is either yours or already earning its place, so ${intent.subject} was added to your ideas instead.` };
  }

  const ops: BeatOp[] = [];
  const used = new Set<string>();
  for (const part of LAUNCH_ARC) {
    const victim = pool.find((b) => !used.has(b.id));
    if (!victim) break;
    used.add(victim.id);
    ops.push({ op: 'remove', id: victim.id });
    ops.push({
      op: 'add',
      date:   clampToMonth(iso(parse(anchor) + part.offsetDays * dayMs), month),
      format: part.format,
      pillar: victim.pillar,   // keep the displaced beat's pillar — the month's balance holds
      title:  `${intent.subject} — ${part.label}`,
      beatMeta: clientInputMeta(intent.sourceText),
    });
  }

  const placed = ops.filter((o) => o.op === 'add').length;
  return placed < LAUNCH_ARC.length
    ? { ops, note: `Added ${placed} of ${LAUNCH_ARC.length} posts for ${intent.subject} — the rest of the month is already spoken for.` }
    : { ops };
}

/** A single dated beat, same replacement rule. */
export function applyEvent(intent: MonthScopedIntent, beats: TransformBeat[], month: string): TransformResult {
  if (!intent.dateRange) return { ops: [], note: 'No date was given, so there was nowhere to put it.' };
  const date = clampToMonth(intent.dateRange.start, month);

  const victim = replacementCandidates(beats, date)[0];
  if (!victim) {
    return { ops: [], note: `Every beat this month is either yours or already earning its place, so ${intent.subject} was added to your ideas instead.` };
  }
  return {
    ops: [
      { op: 'remove', id: victim.id },
      { op: 'add', date, format: victim.format, pillar: victim.pillar, title: intent.subject, beatMeta: clientInputMeta(intent.sourceText) },
    ],
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
    .filter(isReplaceable)                        // client-touched + client-originated protected
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
    case 'emphasis':  return applyEmphasis(intent, beats, today);
    case 'beat_edit': return applyBeatEdit(intent, beats, month);
    case 'correction':return applyCorrection(intent, beats, month);
    default:          return { ops: [] };
  }
}
