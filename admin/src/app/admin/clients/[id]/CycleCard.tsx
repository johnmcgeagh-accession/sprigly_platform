'use client';

// Cycle card — the at-a-glance top-of-page summary of one channel's current cycle: plan month,
// status, the four-beat auto-run timeline (three reminders + the plan run), intake progress,
// grounding readiness, and the primary generate action. ADDITIVE — it supersedes ScheduleReadout
// visually but both render this build (2b removes the readout). No engine behaviour is touched:
// the auto-run flag is READ (passed from the server via isAutoRunEnabled), never written.

import { useState, useTransition } from 'react';
import { deriveTouchSchedule } from '@sprigly/engine/touch-schedule';
import { intakeCompleteness } from '@sprigly/engine/intake-completeness';
import { triggerCycle, type ActionResult } from './actions';
import { fraunces, inter } from './card-fonts';

// ── brand tokens (spec) — inline so no Tailwind config / global restyle is needed ────────────
const CORAL_600 = '#E8705F';
const CORAL_700 = '#C4523F';
const CORAL_800 = '#8A3323';
const CORAL_100 = '#FADDD6';
const CANVAS    = '#F2F3F5';
const BORDER    = '#8F9296';

export interface BeatState {
  sentAt:     string | null;   // ISO instant, or null
  skipReason: string | null;   // 'has_input'|'send_failed'|'no_sender_wired'|'error'|null (0080)
}

export interface CycleCardProps {
  clientId:           string;
  channel:            string;   // raw, e.g. 'instagram'
  dataMonthForAction: string;   // the cohort cycle_month → passed to triggerCycle (same handler as Run cycle now)

  // Header — all three labels derived upstream from cycle_month, passed in once.
  planMonthLabel: string;       // "August 2026"  (cycle_month + 1)
  dataMonthLabel: string;       // "July 2026"    (cycle_month as-is)
  cycleMonth:     string;       // "2026-07"
  status:         string | null;

  // Beat timeline
  reminderDay: number | null;   // schedule.day
  cutoffDay:   number | null;   // schedule.cutoffDay (null ⇒ auto-run not configured)
  today:       { year: number; month: number; day: number };  // London, resolved server-side
  ask:      BeatState;
  nudge:    BeatState;
  lastCall: BeatState;

  // Auto-run master switch (read from the actual flag on the server)
  autoRunEnabled: boolean;
  autoRunEnvName: string;

  // Intake
  answers:   Record<string, string>;
  questions: readonly string[];   // derived once via questionsForChannel — base + channel extras
  freeNotes: string;

  // Grounding (existing sources of truth)
  igStatus:    string | null;   // content_cycles.ig_input_status
  igCheckedAt: string | null;   // content_cycles.ig_input_checked_at (ISO) — the trawl time
  voice:       { present: boolean; sourceMonth: string | null };       // voice_snapshots (is_current)
  catalogue:   { present: boolean; sourceMonth: string | null };       // client_product_catalogue
}

// ── deterministic, hydration-safe date formatters (pinned Europe/London, explicit parts) ─────
function partsFmt(d: Date): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).formatToParts(d)) {
    p[x.type] = x.value;
  }
  return `${p.day} ${p.month}`;
}
/** "13 Jul" for a stored instant. */
function fmtInstant(iso: string): string { return partsFmt(new Date(iso)); }
/** "17 Jul" for a beat's day-of-month in the given month (noon-UTC anchor → London never rolls the day). */
function fmtDayOfMonth(year: number, month: number, day: number): string {
  return partsFmt(new Date(Date.UTC(year, month - 1, day, 12)));
}
function cap(s: string): string { return s.length ? s[0]!.toUpperCase() + s.slice(1) : s; }

const SKIP_REASON_LABEL: Record<string, string> = {
  has_input:       'Suppressed — input landed',
  send_failed:     'Send failed',
  no_sender_wired: 'No sender configured',
  error:           'Errored',
};

type Tone = 'sent' | 'scheduled' | 'muted' | 'warn' | 'blocked' | 'ran';
function toneStyle(tone: Tone): { color: string; background: string; border: string } {
  switch (tone) {
    case 'sent':      return { color: '#166534', background: '#DCFCE7', border: '#BBF7D0' };
    case 'ran':       return { color: '#166534', background: '#DCFCE7', border: '#BBF7D0' };
    case 'scheduled': return { color: CORAL_800, background: CORAL_100, border: '#F3C4B9' };
    case 'warn':      return { color: '#92400E', background: '#FEF3C7', border: '#FDE68A' };
    case 'blocked':   return { color: '#4B5563', background: '#F3F4F6', border: '#E5E7EB' };
    case 'muted':     return { color: '#6B7280', background: CANVAS,   border: '#E5E7EB' };
  }
}

interface BeatCell { name: string; day: number | null; state: { label: string; detail: string | null; tone: Tone }; }

// Precedence a→d for the three reminder beats (exactly the spec order).
function reminderState(beat: BeatState, beatDay: number | null, today: { day: number }): BeatCell['state'] {
  if (beat.sentAt) return { label: 'Sent', detail: fmtInstant(beat.sentAt), tone: 'sent' };
  if (beat.skipReason) {
    const warnish = beat.skipReason === 'send_failed' || beat.skipReason === 'error' || beat.skipReason === 'no_sender_wired';
    return { label: SKIP_REASON_LABEL[beat.skipReason] ?? beat.skipReason, detail: null, tone: warnish ? 'warn' : 'muted' };
  }
  if (beatDay == null) return { label: 'Not scheduled', detail: 'window under 5 days', tone: 'muted' };
  if (beatDay > today.day) return { label: 'Scheduled', detail: null, tone: 'scheduled' }; // detail filled by caller (has month ctx)
  return { label: 'No reminder sent', detail: 'not recorded', tone: 'muted' };            // (d): past + unrecorded
}

// The plan-run (fourth) beat — state (e).
function planRunState(autoRunEnabled: boolean, cutoffDay: number, today: { day: number }, status: string | null): BeatCell['state'] {
  if (!autoRunEnabled) return { label: 'Blocked', detail: 'auto-run off', tone: 'blocked' };
  if (cutoffDay > today.day) return { label: 'Scheduled', detail: null, tone: 'scheduled' };
  // cutoff reached, auto-run on → derive from the cycle status.
  if (status == null) return { label: 'No cycle', detail: null, tone: 'muted' };
  const prestart = ['scheduled', 'requested', 'reply_received', 'awaiting_confirmation'];
  if (status === 'failed') return { label: 'Failed', detail: null, tone: 'warn' };
  if (prestart.includes(status)) return { label: 'Due — not yet run', detail: null, tone: 'warn' };
  return { label: 'Ran', detail: status, tone: 'ran' };
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return <span style={{ color: '#6B7280', background: CANVAS, borderColor: '#E5E7EB' }} className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">no cycle</span>;
  }
  const map: Record<string, Tone> = {
    scheduled: 'muted', requested: 'scheduled', failed: 'warn',
    delivered: 'sent', active: 'sent', workbook_built: 'ran', planning: 'ran', finalised: 'ran', closed: 'muted',
  };
  const t = toneStyle(map[status] ?? 'ran');
  return <span style={{ color: t.color, background: t.background, borderColor: t.border }} className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">{status}</span>;
}

function BeatColumn({ cell }: { cell: BeatCell }) {
  const t = toneStyle(cell.state.tone);
  return (
    <div className="flex flex-col gap-1.5" style={{ minWidth: 0 }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: BORDER }}>
        {cell.name}{cell.day != null && <span style={{ color: '#B4B7BB' }}> · {cell.day}</span>}
      </div>
      <div style={{ color: t.color, background: t.background, borderColor: t.border }} className="inline-flex flex-col rounded-md border px-2.5 py-1.5">
        <span className="text-xs font-medium leading-tight">{cell.state.label}</span>
        {cell.state.detail && <span className="text-[11px] leading-tight opacity-80">{cell.state.detail}</span>}
      </div>
    </div>
  );
}

function GroundLine({ ok, neutral, label, detail }: { ok: boolean; neutral?: boolean; label: string; detail: string }) {
  const mark = ok ? '✓' : (neutral ? '·' : '○');
  const markColor = ok ? '#16A34A' : BORDER;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-bold" style={{ color: markColor }}>{mark}</span>
      <span style={{ color: '#374151' }}>{label}</span>
      <span className="text-xs" style={{ color: BORDER }}>· {detail}</span>
    </div>
  );
}

export function CycleCard(props: CycleCardProps) {
  const {
    clientId, channel, dataMonthForAction,
    planMonthLabel, dataMonthLabel, cycleMonth, status,
    reminderDay, cutoffDay, today, ask, nudge, lastCall,
    autoRunEnabled, autoRunEnvName,
    answers, questions, freeNotes,
    igStatus, igCheckedAt, voice, catalogue,
  } = props;

  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function generate() {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId', clientId);
      fd.set('channel', channel);
      fd.set('dataMonth', dataMonthForAction);
      const r: ActionResult = await triggerCycle(fd);
      if (!r.ok) setActionError(r.message ?? 'Could not start the cycle.');
    });
  }

  // ── Beat timeline model ──────────────────────────────────────────────────────
  const configured = reminderDay != null && cutoffDay != null;
  const sched = configured ? deriveTouchSchedule(reminderDay!, cutoffDay!) : null;

  const beatCells: BeatCell[] = [];
  if (sched) {
    const withDate = (st: BeatCell['state'], day: number | null): BeatCell['state'] =>
      st.label === 'Scheduled' && day != null ? { ...st, detail: fmtDayOfMonth(today.year, today.month, day) } : st;

    beatCells.push({ name: 'Ask',       day: sched.askDay,      state: withDate(reminderState(ask, sched.askDay, today), sched.askDay) });
    beatCells.push({ name: 'Nudge',     day: sched.nudgeDay,    state: withDate(reminderState(nudge, sched.nudgeDay, today), sched.nudgeDay) });
    beatCells.push({ name: 'Last Call', day: sched.lastCallDay, state: withDate(reminderState(lastCall, sched.lastCallDay, today), sched.lastCallDay) });
    beatCells.push({ name: 'Plan run',  day: sched.planRunDay,  state: withDate(planRunState(autoRunEnabled, cutoffDay!, today, status), sched.planRunDay) });
  }

  // ── Intake summary ────────────────────────────────────────────────────────────
  // QUESTION C (intakeCompleteness) — form progress against the CURRENT question list. Distinct
  // from the has-input questions (suppression/plannable); an orphaned answer does not count here.
  const { answered, total } = intakeCompleteness(answers, questions);
  const freeNotesYes = freeNotes.trim().length > 0;

  // ── Grounding ───────────────────────────────────────────────────────────────
  const igOk = igStatus === 'ok';
  const igDetail = igStatus == null
    ? 'not trawled'
    : igOk
      ? (igCheckedAt ? `trawled ${fmtInstant(igCheckedAt)}` : 'trawled')
      : (igCheckedAt ? `${igStatus} · ${fmtInstant(igCheckedAt)}` : igStatus);

  return (
    <div
      className={inter.className}
      style={{ background: '#FFFFFF', borderColor: BORDER, borderRadius: 14 }}
    >
      <div className="border rounded-[14px] overflow-hidden" style={{ borderColor: BORDER }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4" style={{ background: '#FFFFFF' }}>
          <div>
            <h2 className={fraunces.className} style={{ color: '#1A1A1A', fontSize: 26, lineHeight: 1.1 }}>
              {planMonthLabel}{' '}
              <span style={{ fontStyle: 'italic', color: CORAL_700 }}>plan</span>
            </h2>
            <p className="mt-1 text-sm" style={{ color: '#5B5E63' }}>
              {cap(channel)} · from {dataMonthLabel} data · cycle <span className="font-mono">{cycleMonth}</span>
            </p>
          </div>
          <StatusPill status={status} />
        </div>

        {/* Auto-run banner — renders ONLY when the flag is off (as seen by ADMIN's env; the worker
            reads a separate env — see auto-run-flag.ts). Flips off with no code change. */}
        {!autoRunEnabled && (
          <div className="mx-6 mb-4 rounded-lg px-4 py-3" style={{ background: CORAL_100, border: `1px solid #F3C4B9` }}>
            <p className="text-sm font-medium" style={{ color: CORAL_800 }}>
              Auto-run is off for all clients — as seen by admin. The schedule below shows what would happen. Nothing will run until you generate it by hand.
            </p>
            <p className="mt-1 text-xs" style={{ color: CORAL_700 }}>
              Read from <span className="font-mono">{autoRunEnvName}</span> in admin&apos;s environment. Admin and the worker read <span className="font-medium">separate</span> environments, so the worker — not admin — is the process that actually decides whether auto-run fires.
            </p>
          </div>
        )}

        {/* Beat timeline */}
        <div className="px-6 py-4" style={{ background: CANVAS, borderTop: `1px solid #E5E7EB`, borderBottom: `1px solid #E5E7EB` }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: BORDER }}>Schedule</div>
          {configured ? (
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              {beatCells.map((c) => <BeatColumn key={c.name} cell={c} />)}
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#5B5E63' }}>
              Auto-run not configured — manual runs only.{reminderDay != null && <> The reminder/ask email fires on the {reminderDay}.</>}
            </p>
          )}
        </div>

        {/* Intake + grounding */}
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: BORDER }}>Intake</div>
            <p className="text-sm" style={{ color: '#374151' }}>
              <span className="font-semibold" style={{ color: CORAL_800 }}>{answered.length}</span> of {total} questions answered
              {' · '}free notes {freeNotesYes ? 'yes' : 'no'}
            </p>
            {answered.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {answered.map((q) => (
                  <li key={q} className="text-xs flex items-start gap-1.5" style={{ color: '#5B5E63' }}>
                    <span style={{ color: '#16A34A' }} className="font-bold">✓</span>
                    <span className="truncate">{q}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs" style={{ color: BORDER }}>No answers captured yet.</p>
            )}
            <p className="mt-2 text-xs italic" style={{ color: BORDER }}>Summary only — edit in the intake panel below.</p>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: BORDER }}>Grounding</div>
            <div className="space-y-1.5">
              <GroundLine ok={igOk} label="IG posts" detail={igDetail} />
              <GroundLine ok={voice.present} label="Voice profile" detail={voice.present ? (voice.sourceMonth ?? 'set') : 'none'} />
              <GroundLine ok={catalogue.present} neutral={!catalogue.present} label="Catalogue" detail={catalogue.present ? (catalogue.sourceMonth ?? 'set') : 'none'} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderTop: `1px solid #E5E7EB` }}>
          <button
            type="button"
            disabled={isPending}
            onClick={generate}
            style={{ background: CORAL_600, color: '#FFFFFF', fontSize: 14, fontWeight: 500 }}
            className="px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95"
          >
            {isPending ? 'Generating…' : `Generate ${planMonthLabel} plan`}
          </button>

          <span className="text-xs" style={{ color: BORDER }}>
            Re-running regenerates the cycle; reset it first to start clean.
          </span>

          <button
            type="button"
            disabled
            title="More actions — wired when the panels move (build 2b)."
            style={{ color: BORDER, borderColor: '#E5E7EB' }}
            className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border cursor-not-allowed"
          >
            More actions
          </button>
        </div>

        {actionError && (
          <div className="mx-6 mb-4 flex items-start gap-2 text-sm rounded-lg px-3 py-2.5" style={{ color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <span className="shrink-0 font-bold">!</span>
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="ml-auto shrink-0 text-xs" style={{ color: '#F87171' }} aria-label="Dismiss">✕</button>
          </div>
        )}
      </div>
    </div>
  );
}
