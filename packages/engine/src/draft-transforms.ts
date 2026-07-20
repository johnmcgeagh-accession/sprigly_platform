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
  | { op: 'update'; id: string; changes: { date?: string; format?: string; pillar?: string; title?: string } };

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
  const ops: BeatOp[] = eligible.slice(0, convert).map((b) => ({
    op: 'update' as const,
    id: b.id,
    changes: asFormat ? { format: asFormat } : { pillar: target },
  }));
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

/** Dispatch an intent to its transform. */
export function applyIntent(
  intent: MonthScopedIntent, beats: TransformBeat[], month: string, today: string,
): TransformResult {
  switch (intent.kind) {
    case 'launch':    return applyLaunchArc(intent, beats, month);
    case 'event':     return applyEvent(intent, beats, month);
    case 'emphasis':  return applyEmphasis(intent, beats, today);
    case 'beat_edit': return applyBeatEdit(intent, beats, month);
    default:          return { ops: [] };
  }
}
