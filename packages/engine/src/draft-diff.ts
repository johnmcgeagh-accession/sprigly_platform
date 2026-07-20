/**
 * draft-diff.ts — what changed, computed from rows.
 *
 * The receipt is a DIFF of before/after snapshots, not a model's account of what it did.
 * That distinction is load-bearing: a narrated summary can be subtly wrong in ways nobody
 * catches, and the one thing this surface sells is that the client can trust the causality
 * they are shown. If the diff says a beat moved, a beat moved.
 *
 * Pure. No db, no model.
 */

export interface DiffBeat {
  id:       string;
  date:     string;
  format:   string;
  pillar:   string;
  title:    string;
}

export type BeatDelta =
  | { type: 'added';       beat: DiffBeat }
  | { type: 'removed';     beat: DiffBeat }
  | { type: 'moved';       beat: DiffBeat; from: string; to: string }
  | { type: 'reformatted'; beat: DiffBeat; from: string; to: string }
  | { type: 'repillared';  beat: DiffBeat; from: string; to: string }
  | { type: 'retitled';    beat: DiffBeat; from: string; to: string };

export interface DraftDiff {
  deltas: BeatDelta[];
  /** Ids of beats added or changed — the surface marks these until the next visit. */
  changedIds: string[];
}

/**
 * Diff two snapshots by beat id.
 *
 * A beat present in both is compared field by field, and can yield MORE than one delta
 * (moved and reformatted together). That is deliberate: collapsing them into "changed"
 * would hide half of what happened to it.
 *
 * Ordering is stable — added, removed, then per-beat changes in snapshot order — so the
 * same pair of snapshots always renders the same receipt.
 */
export function diffBeats(before: DiffBeat[], after: DiffBeat[]): DraftDiff {
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const afterById  = new Map(after.map((b) => [b.id, b]));

  const deltas: BeatDelta[] = [];
  const changedIds: string[] = [];

  for (const beat of after) {
    if (!beforeById.has(beat.id)) {
      deltas.push({ type: 'added', beat });
      changedIds.push(beat.id);
    }
  }
  for (const beat of before) {
    if (!afterById.has(beat.id)) deltas.push({ type: 'removed', beat });
  }
  for (const beat of after) {
    const was = beforeById.get(beat.id);
    if (!was) continue;
    let touched = false;
    if (was.date   !== beat.date)   { deltas.push({ type: 'moved',       beat, from: was.date,   to: beat.date });   touched = true; }
    if (was.format !== beat.format) { deltas.push({ type: 'reformatted', beat, from: was.format, to: beat.format }); touched = true; }
    if (was.pillar !== beat.pillar) { deltas.push({ type: 'repillared',  beat, from: was.pillar, to: beat.pillar }); touched = true; }
    if (was.title  !== beat.title)  { deltas.push({ type: 'retitled',    beat, from: was.title,  to: beat.title });  touched = true; }
    if (touched) changedIds.push(beat.id);
  }

  return { deltas, changedIds };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-10' → 'Thu 10 Sep'. Falls back to the raw string rather than guessing. */
export function shortDate(dateIso: string): string {
  const t = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(t)) return dateIso;
  const d = new Date(t);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const FORMAT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single post' };
const fmt = (f: string): string => FORMAT_WORD[f] ?? f;

/**
 * One line per delta, in the client's language.
 *
 * Each line states the fact and nothing more. No "we thought", no "to better balance your
 * month" — the rationale for a beat lives on the beat; the receipt's job is to say what
 * moved so the client can check it against what they asked for.
 */
export function renderDelta(delta: BeatDelta): string {
  switch (delta.type) {
    case 'added':       return `Added: ${delta.beat.title}, ${shortDate(delta.beat.date)}`;
    case 'removed':     return `Replaced: ${delta.beat.title}, ${shortDate(delta.beat.date)}`;
    case 'moved':       return `Moved: ${delta.beat.title}, ${shortDate(delta.from)} → ${shortDate(delta.to)}`;
    case 'reformatted': return `Changed: ${delta.beat.title}, ${fmt(delta.from)} → ${fmt(delta.to)}`;
    case 'repillared':  return `Re-angled: ${delta.beat.title}, ${delta.from} → ${delta.to}`;
    case 'retitled':    return `Renamed: ${delta.from} → ${delta.to}`;
    default:            return '';
  }
}

export function renderDiff(diff: DraftDiff): string[] {
  return diff.deltas.map(renderDelta).filter(Boolean);
}

/** True when applying an intent changed nothing — the caller must say so rather than
 *  showing an empty panel that implies something happened. */
export const isNoOp = (diff: DraftDiff): boolean => diff.deltas.length === 0;
