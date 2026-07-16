'use client';

// CardActions — the cycle-scoped manual triggers that live inside the cycle card's "More actions"
// disclosure. MOVED verbatim from ContentCycleOpsPanel (Block C): each control keeps its exact
// handler, gate, and confirm dialog. Reset is a visually-separated destructive group. The card's
// primary "Generate <month> plan" (triggerCycle) stays on the card itself, outside this disclosure.
//
// NOTE (unchanged from the old ops panel): these actions bind to the page-anchored dataMonth
// cycle — the same binding they had before the reorg — not the card's cohort month. `cycleStatus`
// is that cycle's status, so `cycleIsActive`/`cycleIsRequested` are computed exactly as before.

import { useState, useTransition } from 'react';
import {
  triggerTrawl,
  triggerPlanning,
  triggerWeeklySession,
  startCycleForMonth,
  resetCycle,
  copyClientLink,
  type ActionResult,
} from './actions';

interface Props {
  clientId:      string;
  clientName:    string;
  channel:       string;
  dataMonth:     string;
  cycleStatus:   string | null;   // null ⇒ no cycle row for this month
  intakePresent: boolean;         // QUESTION B (plannable) — gates "Run planning now"
}

export function CardActions({ clientId, clientName, channel, dataMonth, cycleStatus, intakePresent }: Props) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [actionError,      setActionError]      = useState<string | null>(null);
  const [clientLink,       setClientLink]       = useState<string | null>(null);
  const [linkCopied,       setLinkCopied]       = useState(false);
  const [startMonth,       setStartMonth]       = useState('');
  const [startNote,        setStartNote]        = useState<string | null>(null);
  const [isPending,        startTransition]     = useTransition();

  const cycleIsActive    = cycleStatus !== null;
  const cycleIsRequested = cycleStatus === 'requested';
  const startMonthValid  = /^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth);

  function callTrigger(action: (fd: FormData) => Promise<ActionResult>, extraFields?: Record<string, string>) {
    setActionError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId',  clientId);
      fd.set('channel',   channel);
      fd.set('dataMonth', dataMonth);
      if (extraFields) Object.entries(extraFields).forEach(([k, v]) => fd.set(k, v));
      const result = await action(fd);
      if (!result.ok) setActionError(result.message ?? 'An error occurred.');
    });
  }

  function copyLink(confirmEmpty = false) {
    setActionError(null);
    setLinkCopied(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId', clientId);
      fd.set('channel', channel);
      fd.set('dataMonth', dataMonth);
      if (confirmEmpty) fd.set('confirmEmpty', 'true');
      const r = await copyClientLink(fd);
      if (!r.ok && r.needsConfirm) {
        const g = globalThis as unknown as { confirm?: (m: string) => boolean };
        const proceed = g.confirm ? g.confirm(r.message ?? 'This cycle has no posts yet. Copy the link anyway?') : false;
        if (proceed) copyLink(true);
        else setActionError('Link not copied — this cycle has no posts yet.');
        return;
      }
      if (!r.ok || !r.url) { setActionError(r.message ?? 'Could not create a client link.'); return; }
      setClientLink(r.url);
      const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator;
      try { if (nav?.clipboard) { await nav.clipboard.writeText(r.url); setLinkCopied(true); } } catch { /* manual copy */ }
    });
  }

  function runStartMonth() {
    setActionError(null);
    setStartNote(null);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) {
      setActionError('Pick a plan month (YYYY-MM) first.');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId',  clientId);
      fd.set('channel',   channel);
      fd.set('planMonth', startMonth);
      const result = await startCycleForMonth(fd);
      if (!result.ok) { setActionError(result.message ?? 'Could not start the month.'); return; }
      setStartNote(result.message ?? `Started ${startMonth}.`);
    });
  }

  return (
    <div className="space-y-4">
      {/* Triggers */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={isPending}
          onClick={() => callTrigger(triggerTrawl)}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
        >
          Run trawl only
        </button>

        <button
          type="button"
          disabled={isPending || !intakePresent}
          onClick={() => callTrigger(triggerPlanning)}
          title={intakePresent
            ? 'Generate next month\'s plan now → build workbook → email the (pinned) test inbox. Re-runnable.'
            : 'Enter intake first — planning needs this month\'s answers.'}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          Run planning now
        </button>

        <button
          type="button"
          disabled={isPending || !cycleIsActive}
          onClick={() => callTrigger(triggerWeeklySession)}
          title={cycleIsActive
            ? 'Run the weekly planning session now — audits the upcoming week (weather, maturing notes, date conflicts) and proposes reviewable changes in the client app. Re-runnable.'
            : 'No cycle yet — run the cycle first.'}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          Run weekly session
        </button>

        <button
          type="button"
          disabled={isPending || !cycleIsActive}
          onClick={() => copyLink()}
          title={cycleIsActive ? 'Mint a revocable magic link to the client app (app.sprigly.co.uk) for this cycle and copy it.' : 'No cycle yet — run the cycle first.'}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          Copy client link
        </button>
      </div>

      {/* Minted client link */}
      {clientLink && (
        <div className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-medium">{linkCopied ? 'Copied' : 'Link'}:</span>
          <code className="break-all text-xs text-gray-600">{clientLink}</code>
          <button type="button" onClick={() => setClientLink(null)} className="ml-auto shrink-0 text-gray-400 hover:text-gray-600 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Start & prepare — run the input-fetch trace for an arbitrary month, stop before planning */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium text-gray-600">Start &amp; prepare:</span>
          <input
            type="month"
            value={startMonth}
            disabled={isPending}
            onChange={(e) => setStartMonth((e.target as unknown as { value: string }).value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          />
          <span className="text-xs text-gray-400">for {channel}</span>
          <button
            type="button"
            disabled={isPending || !startMonthValid}
            onClick={runStartMonth}
            title={`Create/reuse the ${channel} cycle for the chosen plan month and run the input trace (IG trawl → request-email) for its data month. STOPS before planning. No client is emailed; the John-pinned delivery is untouched.`}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Preparing…' : 'Start & prepare'}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Pick the month you want posts <em>for</em> (e.g. <span className="font-mono">2026-07</span> → July posts, data month <span className="font-mono">2026-06</span>).
          Runs the IG trawl + request and <strong>stops before planning</strong>.
        </p>
        {startNote && (
          <div className="mt-3 flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
            <span className="shrink-0 font-bold">✓</span>
            <span>{startNote}</span>
            <button type="button" onClick={() => setStartNote(null)} className="ml-auto shrink-0 text-green-500 hover:text-green-700 text-xs" aria-label="Dismiss">✕</button>
          </div>
        )}
      </div>

      {/* Inline action error */}
      {actionError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">!</span>
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Destructive group — visually separated from the triggers above ──────────── */}
      <div className="pt-3 mt-1 border-t border-red-100">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-red-400 mb-2">Danger zone</div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => { setActionError(null); setShowResetConfirm(true); }}
          className="text-xs text-red-500 underline hover:text-red-700 disabled:opacity-50"
        >
          Reset cycle
        </button>
        {cycleIsActive && (
          <p className="mt-2 text-xs text-amber-600">
            Cycle is <strong>{cycleStatus}</strong> for {dataMonth}.
            {cycleIsRequested && ' A draft may already exist.'}
            {' '}Reset first to re-run cleanly.
          </p>
        )}
      </div>

      {/* ── Confirm: reset ──────────────────────────────────────────── */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Reset cycle for {clientName} — {dataMonth}?
            </h3>
            {cycleIsRequested && (
              <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                This cycle has been run — a draft may already exist. Resetting allows it to re-run and may create another draft.
              </div>
            )}
            <p className="text-sm text-gray-600 mb-6">
              The cycle status will be set back to <strong>scheduled</strong>.
              The content_cycles row is retained; only the status is reset.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowResetConfirm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <form action={resetCycle} onSubmit={() => setShowResetConfirm(false)}>
                <input type="hidden" name="clientId"  value={clientId} />
                <input type="hidden" name="channel"   value={channel} />
                <input type="hidden" name="dataMonth" value={dataMonth} />
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
                  Reset
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
