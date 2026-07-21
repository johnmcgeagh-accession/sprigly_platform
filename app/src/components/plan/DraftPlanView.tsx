'use client';

/**
 * DraftPlanView — the client's draft month. (Build B)
 *
 * This is the surface the whole arc inverts toward: instead of a blank intake form, the
 * client opens their link and finds a month already proposed, with the reason for every
 * beat attached. Their job is to react, not to compose.
 *
 * Mobile-first, and literally so — a vertical list of dated cards, not a squeezed
 * calendar grid. The client reads this on a phone, standing up, between other things.
 * Every control is a tap: a date input, a format select, a delete with undo.
 *
 * It is deliberately, visibly UNFINISHED-looking (dashed edges, "Draft" chip, working
 * copy). A draft that looks like a finished plan invites approval by default, which is
 * the opposite of what this is for.
 *
 * Rationales come from draft-rationale.ts — templates over structured evidence. Nothing
 * on this surface is model-generated at render time.
 */
import React, { useMemo, useRef, useState } from 'react';
import type { DraftBeatView, PostFormat } from '@/lib/types';
import { rationaleFor, slotLabel, assumptionPrompt } from '@/lib/draft-rationale';

/** A change receipt, as persisted on the cycle's intake record. */
export interface DraftReceipt {
  id: string; at: string; sourceText: string;
  scope: 'month_scoped' | 'evergreen';
  reason?: string; lines: string[]; changedIds: string[]; note?: string;
  /** The backlog row, when this receipt filed one — what the rescue tap acts on. */
  planInputId?: string;
}

const C = {
  bg: '#F8F9FB', card: '#FFFFFF', navy: '#1E2A4A', muted: '#5B647A', faint: '#98A0AE',
  line: '#E8EAEE', coral: '#FF6F62', coralDeep: '#E2574B', coralLt: '#FFEDEB',
  navyLt: '#EDEFF4', amber: '#B7791F', amberLt: '#FEF6E7',
};
const body = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

const FORMATS: PostFormat[] = ['single', 'carousel', 'reel'];
const FORMAT_LABEL: Record<string, string> = { single: 'Single post', carousel: 'Carousel', reel: 'Reel' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateParts(iso: string): { day: string; date: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { day: '', date: iso };
  return { day: DAYS[d.getUTCDay()] ?? '', date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ''}` };
}

export interface DraftPlanViewProps {
  beats:      DraftBeatView[];
  monthLabel: string;
  clientName: string;
  /** Pillars the client may add a beat under — their configured vocabulary, nothing else. */
  pillars:    string[];
  /** Applies one mutation and resolves with the new beat list, or an error message. */
  onMutate:   (op: Record<string, unknown>) => Promise<{ ok: boolean; beats?: DraftBeatView[]; message?: string; dropped?: Record<string, unknown> }>;
  /** Sends a sentence of intake. Resolves with the receipt and the reshaped month. */
  onSay?:     (text: string) => Promise<{ ok: boolean; application?: DraftReceipt; beats?: DraftBeatView[]; message?: string }>;
  /** The cycle being reviewed — approval navigates back to it by name. */
  cycleId?:      string | undefined;
  /** Rescue a filed idea into this month (Build C's one-tap, finally wired). */
  onAddToMonth?: (planInputId: string, date: string) => Promise<{ ok: boolean; application?: DraftReceipt; beats?: DraftBeatView[]; message?: string }>;
  /** Receipts already stored for this cycle, newest first — so they survive a reload. */
  receipts?:  DraftReceipt[];
  /** False once the cycle passes its cutoff — the draft stays readable, just not editable. */
  editable?:  boolean;
  /** Approves the month and starts generation. Absent → no approval affordance at all. */
  onApprove?: () => Promise<{ ok: boolean; message?: string }>;
}

/**
 * Is this blur a real date change worth a mutation?
 *
 * Pure and exported so the rule can be tested without a DOM — the admin/app harness is a node
 * environment, and a rule that can only be verified by clicking is a rule that rots.
 */
export function isRealDateChange(current: string, next: string): boolean {
  if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return false;   // cleared or half-typed
  return next !== current;
}

export function DraftPlanView({ beats: initial, monthLabel, clientName, pillars, cycleId, onMutate, onSay, onAddToMonth, onApprove, receipts = [], editable = true }: DraftPlanViewProps) {
  const [beats, setBeats] = useState<DraftBeatView[]>(initial);
  const [receipt, setReceipt] = useState<DraftReceipt | null>(receipts[0] ?? null);
  const [saying, setSaying] = useState(false);
  const [said, setSaid] = useState('');
  // Changed beats carry a marker until the next visit. One boolean's worth of state, held
  // in memory and gone on reload — a persisted seen-state would be a lot of machinery for
  // a highlight that has already done its job by the time they look away.
  const [changedIds, setChangedIds] = useState<string[]>(receipts[0]?.changedIds ?? []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A single undo slot, not a history stack: the affordance is "I didn't mean that",
  // which is the last action only. Anything deeper is a job for the agent in Build C.
  const undo = useRef<{ label: string; op: Record<string, unknown> } | null>(null);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  // Approval is two taps, never one. The second tap states the consequence in numbers —
  // this is the point at which we start spending the client's money and writing content
  // they will be asked to publish, and a single mis-tap should not reach it.
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);

  // The month's assumptions are identical across beats (the assembler attaches the same
  // list to each), so surface them ONCE at the top rather than repeating them on 10 cards.
  const monthAssumptions = useMemo(() => {
    const seen = new Set<string>();
    for (const b of beats) for (const a of b.assumptions) seen.add(a);
    return [...seen];
  }, [beats]);

  async function mutate(op: Record<string, unknown>, beatId: string | null, undoOp?: { label: string; op: Record<string, unknown> }) {
    setBusyId(beatId ?? 'new');
    setError(null);
    // Refetch-on-success, matching how the plan surface already handles structural edits —
    // the server returns the authoritative list, so the client never guesses at the result.
    const res = await onMutate(op);
    setBusyId(null);
    if (!res.ok) { setError(res.message ?? 'That didn’t work. Try again?'); return; }
    if (res.beats) setBeats(res.beats);

    // A drop hands back the WHOLE beat. Undo puts that back verbatim — title, evidence,
    // position and all. Rebuilding it from {date, format, pillar} turned a launch beat into
    // a subjectless husk (docs/reports/uat-findings-fixes.md, Part 0).
    const restore = res.dropped
      ? { label: 'Beat removed', op: { op: 'restore', beat: res.dropped } as Record<string, unknown> }
      : undoOp;
    if (restore) { undo.current = restore; setUndoLabel(restore.label); } else { undo.current = null; setUndoLabel(null); }
  }

  /**
   * Commit a date change, if it IS one.
   *
   * Two guards, both of which the rehearsal needed. A blur with the date unchanged is not an
   * edit — the client opened the picker and closed it, or tabbed through — and sending it
   * costs a DB write, an activity row, and a `beat_moved` entry reading "24 Aug → 24 Aug"
   * that makes the ledger harder to read. An empty value means the picker was cleared rather
   * than set, which is not a date and must not be sent as one.
   *
   * Exported logic lives in `isRealDateChange` so the rule is testable without a DOM.
   */
  function commitDate(beat: DraftBeatView, next: string): void {
    if (!isRealDateChange(beat.date, next)) return;
    void mutate({ op: 'move', postId: beat.id, date: next }, beat.id,
      { label: 'Date changed', op: { op: 'move', postId: beat.id, date: beat.date } });
  }

  /**
   * Where a rescued idea lands: the first day of this month the client can still edit.
   * Deterministic and near, so the beat is visible immediately and they can move it with the
   * date control — better than inventing a date deep in the month they then have to hunt for.
   */
  function rescueDate(): string {
    const first = beats.map((b) => b.date).sort()[0];
    return first ?? new Date().toISOString().slice(0, 10);
  }

  const [rescuing, setRescuing] = useState(false);
  async function rescue(planInputId: string) {
    if (!onAddToMonth) return;
    setRescuing(true); setError(null);
    const res = await onAddToMonth(planInputId, rescueDate());
    setRescuing(false);
    if (!res.ok) { setError(res.message ?? 'That didn’t work. Try again?'); return; }
    if (res.beats) setBeats(res.beats);
    if (res.application) { setReceipt(res.application); setChangedIds(res.application.changedIds ?? []); }
  }

  async function runUndo() {
    const u = undo.current;
    if (!u) return;
    undo.current = null; setUndoLabel(null);
    await mutate(u.op, null);
  }

  async function say() {
    const text = said.trim();
    if (!text || !onSay) return;
    setSaying(true); setError(null);
    const res = await onSay(text);
    setSaying(false);
    if (!res.ok) { setError(res.message ?? 'That didn’t work. Try again?'); return; }
    setSaid('');
    if (res.beats) setBeats(res.beats);
    if (res.application) { setReceipt(res.application); setChangedIds(res.application.changedIds); }
  }

  async function approve() {
    if (!onApprove) return;
    setApproving(true); setError(null);
    const res = await onApprove();
    setApproving(false);
    if (!res.ok) { setError(res.message ?? 'We couldn’t start that. Try again?'); return; }
    // Land on the month they just approved, by NAME.
    //
    // A bare reload re-ran the landing rule from scratch, and approval is exactly the moment
    // that rule stops working: it moves every draft row to 'generating', so
    // cycleHasReviewableDraft goes false and resolveDayCycleId falls back to picking by
    // today's date — which sent earl-of-east to August seconds after they approved October
    // (docs/reports/round-two-email-and-surface.md §B3). "I just approved this month" is
    // explicit intent and should outrank a heuristic about today.
    window.location.assign(cycleId ? `/?cycle=${encodeURIComponent(cycleId)}` : '/');
  }

  const reelCount = useMemo(() => beats.filter((b) => b.format === 'reel').length, [beats]);
  const hookCount = useMemo(() => beats.filter((b) => b.format === 'reel' || b.format === 'carousel').length, [beats]);

  const byDate = useMemo(() => [...beats].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position), [beats]);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.navy, fontFamily: body }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 96px' }}>

        {/* Header — says plainly that this is a draft and what to do with it. */}
        <header style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.coralDeep, background: C.coralLt, padding: '4px 9px', borderRadius: 999 }}>
              Draft
            </span>
            <span style={{ fontSize: 13, color: C.faint }}>Not sent yet</span>
          </div>
          <h1 style={{ fontSize: 24, lineHeight: 1.25, margin: '0 0 6px', fontWeight: 700 }}>
            We’ve drafted {monthLabel} for {clientName}
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: C.muted, margin: 0 }}>
            It’s built from what’s been working on your feed. Change anything that’s wrong —
            move a date, swap a format, drop what you don’t want.
          </p>
        </header>

        {/* Assumptions — display only in this build. Answering them is Build C. */}
        {monthAssumptions.length > 0 && (
          <section aria-label="What we assumed" style={{ background: C.amberLt, border: `1px solid #F5E2BE`, borderRadius: 12, padding: '13px 14px', marginBottom: 18 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.amber, margin: '0 0 8px' }}>
              What we assumed
            </h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {monthAssumptions.map((a) => (
                <li key={a} style={{ fontSize: 14, lineHeight: 1.5, color: C.navy }}>{assumptionPrompt(a)}</li>
              ))}
            </ul>
            <p style={{ fontSize: 12.5, color: C.muted, margin: '9px 0 0' }}>
              {onSay ? 'Answer any of these below and we’ll work it in.' : 'Reply to our email and we’ll work it in.'}
            </p>
          </section>
        )}

        {/* Say something — the north-star input. One sentence reshapes the month. */}
        {editable && onSay && (
          <section aria-label="Tell us about this month" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13, marginBottom: 14 }}>
            <label htmlFor="draft-say" style={{ display: 'block', fontSize: 13.5, fontWeight: 600, marginBottom: 7 }}>
              Anything we should know?
            </label>
            <textarea
              id="draft-say" value={said} disabled={saying} rows={2}
              onChange={(e) => setSaid(e.target.value)}
              placeholder="e.g. the Wilderness candle relaunches on the 24th"
              style={{ width: '100%', font: 'inherit', fontSize: 15, lineHeight: 1.45, padding: '10px 11px', border: `1px solid ${C.line}`, borderRadius: 10, resize: 'vertical', color: C.navy, boxSizing: 'border-box' }}
            />
            <button type="button" onClick={say} disabled={saying || !said.trim()}
              style={{ marginTop: 8, width: '100%', minHeight: 46, font: 'inherit', fontSize: 15, fontWeight: 700, color: '#fff', background: C.coral, border: 0, borderRadius: 10, cursor: 'pointer', opacity: saying || !said.trim() ? 0.5 : 1 }}>
              {saying ? 'Working…' : 'Tell Sprigly'}
            </button>
          </section>
        )}

        {/* What changed — computed from row deltas, never narrated. Dismissible. */}
        {receipt && (
          <section aria-label={receipt.scope === 'evergreen' ? 'Saved to your ideas' : 'What changed'} style={{ background: C.navyLt, border: `1px solid ${C.line}`, borderRadius: 12, padding: '13px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: 0 }}>
                {receipt.scope !== 'evergreen' ? 'What changed'
                  : receipt.reason === 'couldnt_apply' ? 'We couldn’t apply this' : 'Saved to your ideas'}
              </h2>
              <button type="button" onClick={() => setReceipt(null)} aria-label="Dismiss what changed"
                style={{ font: 'inherit', fontSize: 13, color: C.faint, background: 'transparent', border: 0, cursor: 'pointer', minHeight: 28, padding: 0 }}>
                Dismiss
              </button>
            </div>
            <p style={{ fontSize: 13, color: C.muted, fontStyle: 'italic', margin: '7px 0 0' }}>“{receipt.sourceText}”</p>
            {receipt.scope === 'evergreen' ? (
              <p style={{ fontSize: 14, lineHeight: 1.5, margin: '8px 0 0' }}>
                {/* couldnt_apply is NOT a filing the client asked for. Saying "saved to your
                    ideas" for a failed extraction is the silent demotion that cost a client
                    their Meadow launch twice — the copy has to admit what happened. */}
                {receipt.reason === 'couldnt_apply'
                  ? <>We couldn’t apply this to {monthLabel} automatically, so we’ve saved it to your ideas.</>
                  : <>We’ve kept this for later rather than changing {monthLabel}.</>}
                {' '}If you meant now, add it to this month.
              </p>
            ) : receipt.lines.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 5 }}>
                {receipt.lines.map((line) => (
                  <li key={line} style={{ fontSize: 14, lineHeight: 1.45 }}>{line}</li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 14, margin: '8px 0 0' }}>Nothing needed changing.</p>
            )}
            {receipt.note && <p style={{ fontSize: 13, color: C.muted, margin: '8px 0 0' }}>{receipt.note}</p>}
            {/* Build C's one-tap rescue. The server op shipped without it, so every evergreen
                receipt pointed at an ideas list this surface has no control for. */}
            {receipt.scope === 'evergreen' && receipt.planInputId && onAddToMonth && editable && (
              <button
                type="button" disabled={rescuing}
                data-testid="add-to-this-month"
                onClick={() => rescue(receipt.planInputId!)}
                style={{ font: 'inherit', fontSize: 14, fontWeight: 700, marginTop: 11, minHeight: 44,
                  padding: '10px 15px', borderRadius: 10, border: `1.5px solid ${C.coral}`,
                  background: C.coralLt, color: C.coralDeep, cursor: rescuing ? 'default' : 'pointer' }}
              >
                {rescuing ? 'Adding…' : 'Add to this month'}
              </button>
            )}
          </section>
        )}

        {error && (
          <div role="alert" style={{ background: C.coralLt, border: `1px solid ${C.coral}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 14, color: C.coralDeep }}>
            {error}
          </div>
        )}

        {/* The beats. A vertical dated list — phone-shaped, not a squeezed grid. */}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {byDate.map((beat) => {
            const { day, date } = dateParts(beat.date);
            const reason = rationaleFor(beat.evidence, beat.pillar);
            const label = slotLabel(beat.slotType);
            const busy = busyId === beat.id;
            const changed = changedIds.includes(beat.id);
            return (
              <li key={beat.id} style={{
                background: C.card, border: `1px dashed ${changed ? C.coral : C.line}`, borderRadius: 14,
                padding: '13px 14px', opacity: busy ? 0.55 : 1, transition: 'opacity .12s',
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div aria-hidden style={{ minWidth: 46, textAlign: 'center', paddingTop: 2 }}>
                    <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>{day}</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{date}</div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.navy, background: C.navyLt, padding: '3px 8px', borderRadius: 999 }}>
                        {FORMAT_LABEL[beat.format] ?? beat.format}
                      </span>
                      <span style={{ fontSize: 11.5, color: C.muted }}>{beat.pillar}</span>
                      {label && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.coralDeep, background: C.coralLt, padding: '3px 8px', borderRadius: 999 }}>
                          {label}
                        </span>
                      )}
                      {changed && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.coralDeep }}>Just changed</span>
                      )}
                    </div>

                    <p style={{ fontSize: 15, lineHeight: 1.4, fontWeight: 600, margin: '0 0 5px' }}>{beat.title}</p>
                    {reason && <p style={{ fontSize: 13, lineHeight: 1.5, color: C.muted, margin: 0 }}>{reason}</p>}

                    {editable && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
                        <label style={{ fontSize: 12.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span className="sr-only">Date for {beat.title}</span>
                          <input
                            type="date" defaultValue={beat.date} key={beat.date} disabled={busy}
                            aria-label={`Date for ${beat.title}`}
                            // COMMIT ON BLUR, not on every onChange. A date input emits a
                            // change per intermediate value the picker produces, so binding
                            // the mutation to onChange sent a write (and an activity row) per
                            // keystroke — ivy-t's rehearsal logged every move twice, once with
                            // from == to (docs/reports/ivy-t-rehearsal-failures.md).
                            // `key={beat.date}` remounts the input when the server's
                            // authoritative date comes back, so an uncontrolled field can
                            // never drift from the beat it belongs to.
                            onBlur={(e) => commitDate(beat, e.currentTarget.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            style={{ font: 'inherit', fontSize: 13, padding: '7px 9px', minHeight: 40, border: `1px solid ${C.line}`, borderRadius: 9, background: '#fff', color: C.navy }}
                          />
                        </label>

                        <select
                          value={beat.format} disabled={busy}
                          aria-label={`Format for ${beat.title}`}
                          onChange={(e) => mutate({ op: 'format', postId: beat.id, format: e.target.value }, beat.id,
                            { label: 'Format changed', op: { op: 'format', postId: beat.id, format: beat.format } })}
                          style={{ font: 'inherit', fontSize: 13, padding: '7px 9px', minHeight: 40, border: `1px solid ${C.line}`, borderRadius: 9, background: '#fff', color: C.navy }}
                        >
                          {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
                        </select>

                        <button
                          type="button" disabled={busy}
                          onClick={() => mutate({ op: 'drop', postId: beat.id }, beat.id)}
                          style={{ font: 'inherit', fontSize: 13, minHeight: 40, padding: '7px 11px', border: `1px solid ${C.line}`, borderRadius: 9, background: '#fff', color: C.muted, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {beats.length === 0 && (
          <p style={{ fontSize: 14.5, color: C.muted, textAlign: 'center', padding: '32px 0' }}>
            Nothing in this draft yet.
          </p>
        )}

        {editable && onApprove && beats.length > 0 && (
          <section aria-label="Approve this month" style={{ marginTop: 22, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15 }}>
            {!confirming ? (
              <>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Happy with it?</h2>
                <p style={{ fontSize: 14, lineHeight: 1.5, color: C.muted, margin: '0 0 12px' }}>
                  We’ll write the captions, hooks and scripts. You can still change dates and formats afterwards.
                </p>
                <button type="button" onClick={() => setConfirming(true)}
                  style={{ width: '100%', minHeight: 50, font: 'inherit', fontSize: 15.5, fontWeight: 700, color: '#fff', background: C.coral, border: 0, borderRadius: 11, cursor: 'pointer' }}>
                  Looks good — generate my plan
                </button>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>Ready to go?</h2>
                {/* The consequence, in numbers, before the money is spent. */}
                <p style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 12px' }}>
                  We’ll write captions for all <strong>{beats.length}</strong> posts
                  {hookCount > 0 ? <>, opening hooks for the <strong>{hookCount}</strong> reels and carousels</> : null}
                  {reelCount > 0 ? <>, and a script for {reelCount === 1 ? 'the' : 'each of the'} <strong>{reelCount}</strong> {reelCount === 1 ? 'reel' : 'reels'}</> : null}
                  . This takes a few minutes.
                </p>
                {/* What approval ACTUALLY does. The old copy said "after this the dates and
                    formats are set for the month", which is not true: every post stays
                    editable on the calendar by date until its own date passes (the
                    isEditableDate rule the whole surface is built on). Telling a client
                    their month is locked when it is not makes them rush a decision that did
                    not need rushing — and teaches them the interface lies. */}
                <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px' }}>
                  Dates and formats stay yours to change afterwards, right up until each post’s date.
                  What this starts is the writing.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={approve} disabled={approving}
                    style={{ flex: 1, minHeight: 48, font: 'inherit', fontSize: 15, fontWeight: 700, color: '#fff', background: C.coral, border: 0, borderRadius: 10, cursor: 'pointer', opacity: approving ? 0.6 : 1 }}>
                    {approving ? 'Starting…' : 'Yes, generate it'}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={approving}
                    style={{ minHeight: 48, padding: '0 16px', font: 'inherit', fontSize: 15, color: C.muted, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, cursor: 'pointer' }}>
                    Not yet
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {editable && (
          <AddBeat
            pillars={pillars}
            busy={busyId === 'new'}
            open={adding}
            onOpen={() => setAdding(true)}
            onCancel={() => setAdding(false)}
            onAdd={async (spec) => { await mutate({ op: 'add', ...spec }, null); setAdding(false); }}
          />
        )}
      </div>

      {/* Undo — one slot, bottom-anchored so a thumb can reach it. */}
      {undoLabel && (
        <div role="status" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 20, zIndex: 60,
          background: C.navy, color: '#fff', padding: '11px 14px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5, maxWidth: 'min(520px, 92vw)',
          boxShadow: '0 12px 32px rgba(30,42,74,.26)',
        }}>
          <span>{undoLabel}</span>
          <button type="button" onClick={runUndo}
            style={{ font: 'inherit', fontWeight: 700, color: '#fff', background: 'transparent', border: 0, textDecoration: 'underline', cursor: 'pointer', minHeight: 32 }}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/** Add-a-beat, collapsed until asked for so it never competes with the draft itself. */
function AddBeat({ pillars, busy, open, onOpen, onCancel, onAdd }: {
  pillars: string[]; busy: boolean; open: boolean;
  onOpen: () => void; onCancel: () => void;
  onAdd: (spec: { date: string; format: string; pillar: string }) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [format, setFormat] = useState<PostFormat>('single');
  const [pillar, setPillar] = useState(pillars[0] ?? '');

  // No configured pillars means addBeat would refuse anyway — don't offer the affordance.
  if (pillars.length === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={onOpen}
        style={{ marginTop: 14, width: '100%', minHeight: 46, font: 'inherit', fontSize: 14, fontWeight: 600, color: C.coralDeep, background: '#fff', border: `1px dashed ${C.coral}`, borderRadius: 12, cursor: 'pointer' }}>
        + Add something
      </button>
    );
  }

  return (
    <div style={{ marginTop: 14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'grid', gap: 9 }}>
        <label style={{ fontSize: 13, color: C.muted, display: 'grid', gap: 4 }}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ font: 'inherit', fontSize: 14, padding: '9px 10px', minHeight: 42, border: `1px solid ${C.line}`, borderRadius: 9 }} />
        </label>
        <label style={{ fontSize: 13, color: C.muted, display: 'grid', gap: 4 }}>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as PostFormat)}
            style={{ font: 'inherit', fontSize: 14, padding: '9px 10px', minHeight: 42, border: `1px solid ${C.line}`, borderRadius: 9 }}>
            {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13, color: C.muted, display: 'grid', gap: 4 }}>
          Pillar
          <select value={pillar} onChange={(e) => setPillar(e.target.value)}
            style={{ font: 'inherit', fontSize: 14, padding: '9px 10px', minHeight: 42, border: `1px solid ${C.line}`, borderRadius: 9 }}>
            {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
          <button type="button" disabled={busy || !date} onClick={() => onAdd({ date, format, pillar })}
            style={{ flex: 1, minHeight: 44, font: 'inherit', fontSize: 14, fontWeight: 700, color: '#fff', background: C.coral, border: 0, borderRadius: 10, cursor: 'pointer', opacity: !date ? 0.5 : 1 }}>
            Add it
          </button>
          <button type="button" onClick={onCancel}
            style={{ minHeight: 44, padding: '0 14px', font: 'inherit', fontSize: 14, color: C.muted, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
