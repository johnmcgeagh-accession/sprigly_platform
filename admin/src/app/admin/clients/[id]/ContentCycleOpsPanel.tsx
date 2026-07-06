'use client';

import { useState, useTransition } from 'react';
import {
  triggerCycle,
  triggerTrawl,
  triggerEmail,
  triggerPlanning,
  startCycleForMonth,
  resetCycle,
  copyClientLink,
  setDeliverySurface,
  setAiChangeLimit,
  liftAiLimit,
  clearAiLimitOverride,
  setPostsPerWeek,
  type ActionResult,
} from './actions';
import { uploadSales, uploadIgPosts, addCompetitor, removeCompetitor, type InputActionResult } from './input-actions';
import { formatDateTime, formatDateTimeShort } from '@/lib/format-date';

interface DriveFileMeta {
  id:           string;
  name:         string;
  mimeType:     string;
  modifiedTime: string;
}

interface CycleInfo {
  status:          string;
  requestSentAt:   string | null;  // ISO string (Date serialised from server)
  postsSyncStatus: string | null;  // 'synced' | 'out_of_sync' | 'unknown' | null — app-plan write health
}

interface Props {
  clientId:            string;
  clientName:          string;
  channel:             string;
  dataMonth:           string;
  instagramHandle:     string | null;
  contactEmail:        string | null;
  contentCycleEnabled: boolean;
  cycle:               CycleInfo | null;
  deliverySurface:     'app' | 'sheet' | 'both';  // what the delivery email links to
  aiChangeLimit:       number;         // monthly AI-change allowance (rewrites/regen)
  aiChangeLimitOverrideUntil: string | null;  // ISO; future = unlimited
  postsPerWeek:        number | null;  // null = derive from config/history
  competitors:         string[];       // client_planning_config.competitors (bare handles)
  igInputStatus:       string | null;  // last ig-trawl outcome for this month
  igInputDetail:       string | null;
  intakePresent:       boolean;  // planContent answers/freeNotes present → planning can run
  driveFiles:          DriveFileMeta[] | null;  // null = fetch failed / no tokens
  driveError:          boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Deterministic, hydration-safe formatters (see @/lib/format-date).
const fmtDate = formatDateTime;
const fmtModified = formatDateTimeShort;

// "YYYY-MM" → previous month "YYYY-MM" (the data month behind a plan month).
// Deterministic in its input (no `new Date()` now), so hydration-safe.
function prevMonthUI(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    scheduled:  'bg-gray-100 text-gray-600',
    requested:  'bg-blue-100 text-blue-700',
    failed:     'bg-red-100 text-red-700',
    delivered:  'bg-green-100 text-green-700',
    closed:     'bg-gray-100 text-gray-500',
  };
  const cls = colours[status] ?? 'bg-purple-100 text-purple-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function ContentCycleOpsPanel({
  clientId,
  clientName,
  channel,
  dataMonth,
  instagramHandle,
  contactEmail,
  contentCycleEnabled,
  cycle,
  deliverySurface,
  aiChangeLimit,
  aiChangeLimitOverrideUntil,
  postsPerWeek,
  competitors,
  igInputStatus,
  igInputDetail,
  intakePresent,
  driveFiles,
  driveError,
}: Props) {
  const [showResetConfirm,   setShowResetConfirm]   = useState(false);
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
  const [actionError,        setActionError]         = useState<string | null>(null);
  const [clientLink,         setClientLink]          = useState<string | null>(null);
  const [linkCopied,         setLinkCopied]          = useState(false);
  const [startMonth,         setStartMonth]          = useState('');
  const [startNote,          setStartNote]           = useState<string | null>(null);
  const [aiLimitInput,       setAiLimitInput]         = useState(String(aiChangeLimit));
  const [ppwInput,           setPpwInput]             = useState(postsPerWeek != null ? String(postsPerWeek) : '');
  const [isPending,          startTransition]        = useTransition();

  const overrideActive = aiChangeLimitOverrideUntil != null && new Date(aiChangeLimitOverrideUntil).getTime() > Date.now();

  function copyLink() {
    setActionError(null);
    setLinkCopied(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('clientId', clientId);
      fd.set('channel', channel);
      fd.set('dataMonth', dataMonth);
      const r = await copyClientLink(fd);
      if (!r.ok || !r.url) { setActionError(r.message ?? 'Could not create a client link.'); return; }
      setClientLink(r.url);
      // Best-effort clipboard via a typed globalThis cast (admin's tsconfig has no DOM lib);
      // the URL is also shown in the UI so it can be copied manually if this is unavailable.
      const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator;
      try { if (nav?.clipboard) { await nav.clipboard.writeText(r.url); setLinkCopied(true); } } catch { /* manual copy */ }
    });
  }

  const salesFile = `sales-${dataMonth}.csv`;
  const postsFile = `instagram-posts-${dataMonth}.json`;

  const hasSalesFile = driveFiles?.some(f => f.name.toLowerCase() === salesFile.toLowerCase()) ?? false;
  const hasPostsFile = driveFiles?.some(f => f.name.toLowerCase() === postsFile.toLowerCase()) ?? false;

  const cycleIsActive    = cycle !== null && cycle.status !== 'scheduled';
  const cycleIsRequested = cycle?.status === 'requested';

  // "Start & prepare" inputs check: the picked plan month's DATA month is planMonth−1;
  // ig-trawl/sales fetch for that data month, so check Drive for those files.
  const startMonthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth);
  const startDataMonth  = startMonthValid ? prevMonthUI(startMonth) : null;
  const startHasPosts = startDataMonth
    ? (driveFiles?.some(f => f.name.toLowerCase() === `instagram-posts-${startDataMonth}.json`.toLowerCase()) ?? false)
    : false;
  const startHasSales = startDataMonth
    ? (driveFiles?.some(f => f.name.toLowerCase() === `sales-${startDataMonth}.csv`.toLowerCase()) ?? false)
    : false;

  function callTrigger(
    action: (fd: FormData) => Promise<ActionResult>,
    extraFields?: Record<string, string>,
  ) {
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

  // "Start & prepare" — run the automated input-fetch trace (ig-trawl → request-email)
  // for an arbitrary plan month on THIS channel, stopping BEFORE planning. planMonth
  // is the month you want posts for; the action derives the data month (planMonth − 1).
  // Surfaces the success note, not just errors.
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
    <div className="space-y-6">

      {/* ── Block A: Readiness ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-6">

        {/* Config readiness */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Config readiness
          </h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              {instagramHandle ? (
                <span className="text-green-500 font-bold">✓</span>
              ) : (
                <span className="text-gray-300 font-bold">✗</span>
              )}
              <span className="text-gray-700">
                Instagram handle
                {instagramHandle && (
                  <span className="ml-1 font-mono text-gray-400 text-xs">@{instagramHandle}</span>
                )}
              </span>
            </li>
            <li className="flex items-center gap-2">
              {contactEmail ? (
                <span className="text-green-500 font-bold">✓</span>
              ) : (
                <span className="text-red-500 font-bold">✗</span>
              )}
              <span className={contactEmail ? 'text-gray-700' : 'text-red-600 font-medium'}>
                Contact email{!contactEmail && ' — cycle will hard-fail'}
              </span>
            </li>
            <li className="flex items-center gap-2">
              {contentCycleEnabled ? (
                <span className="text-green-500 font-bold">✓</span>
              ) : (
                <span className="text-gray-300 font-bold">✗</span>
              )}
              <span className="text-gray-700">
                Cycle enabled
              </span>
            </li>
          </ul>
        </div>

        {/* Cycle status */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Cycle — <span className="font-mono normal-case">{dataMonth}</span>
          </h3>
          {cycle ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-gray-400 w-24 shrink-0">Status</dt>
                <dd><StatusBadge status={cycle.status} /></dd>
              </div>
              {cycle.postsSyncStatus === 'out_of_sync' && (
                <div className="flex items-center gap-2">
                  <dt className="text-gray-400 w-24 shrink-0">App plan</dt>
                  <dd className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    ⚠️ out of sync — posts-write failed; app is showing a stale plan
                  </dd>
                </div>
              )}
              {cycle.postsSyncStatus === 'unknown' && (
                <div className="flex items-center gap-2">
                  <dt className="text-gray-400 w-24 shrink-0">App plan</dt>
                  <dd className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    ⚠️ unverified — last regen failed before writing; app plan not confirmed current
                  </dd>
                </div>
              )}
              {cycle.requestSentAt && (
                <div className="flex items-center gap-2">
                  <dt className="text-gray-400 w-24 shrink-0">Ran at</dt>
                  <dd className="text-gray-700">{fmtDate(cycle.requestSentAt)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-400">No cycle row for {dataMonth} yet.</p>
          )}
        </div>
      </div>

      {/* ── Block B: Drive contents ─────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Drive folder contents
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          Showing files visible to the app (drive.file scope) — files added via the Drive web UI won&apos;t appear.
        </p>

        {/* Pipeline-file presence indicators */}
        <div className="flex gap-4 mb-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            hasSalesFile ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}>
            {hasSalesFile ? '✓' : '○'} {salesFile}
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            hasPostsFile ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}>
            {hasPostsFile ? '✓' : '○'} {postsFile}
          </span>
        </div>

        {driveError || driveFiles === null ? (
          <p className="text-sm text-gray-400 italic">
            Unable to list Drive files — check Drive OAuth connection.
          </p>
        ) : driveFiles.length === 0 ? (
          <p className="text-sm text-gray-400">No app-visible files in this folder.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-400 text-xs">
                <th className="py-1.5 pr-4 font-medium">Name</th>
                <th className="py-1.5 pr-4 font-medium">Type</th>
                <th className="py-1.5 font-medium">Modified</th>
              </tr>
            </thead>
            <tbody>
              {driveFiles.map((f) => {
                const isPipeline =
                  f.name.toLowerCase() === salesFile.toLowerCase() ||
                  f.name.toLowerCase() === postsFile.toLowerCase();
                return (
                  <tr key={f.id} className={`border-b border-gray-50 ${isPipeline ? 'bg-green-50/50' : ''}`}>
                    <td className="py-1.5 pr-4 font-mono text-xs text-gray-800">
                      {f.name}
                      {isPipeline && (
                        <span className="ml-1.5 text-green-600 font-sans font-medium text-xs">✓</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-gray-400 text-xs">
                      {f.mimeType.split('/').pop()}
                    </td>
                    <td className="py-1.5 text-gray-400 text-xs">
                      {fmtModified(f.modifiedTime)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Block C: Actions ────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Actions — <span className="font-mono normal-case">{dataMonth}</span>
        </h3>

        <div className="flex items-start gap-3 flex-wrap">

          {/* PRIMARY: Run cycle now */}
          <button
            type="button"
            disabled={isPending}
            onClick={() => cycleIsActive ? setShowTriggerConfirm(true) : callTrigger(triggerCycle)}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Running…' : 'Run cycle now'}
          </button>

          {/* POWER TOOLS — visually subordinate */}
          <div className="flex items-center gap-3 ml-2 pl-3 border-l border-gray-200">
            <span className="text-xs text-gray-400">Power tools:</span>

            <button
              type="button"
              disabled={isPending}
              onClick={() => callTrigger(triggerTrawl)}
              className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
            >
              Run trawl only
            </button>

            <TriggerEmailButton
              hasPostsFile={hasPostsFile}
              isPending={isPending}
              onTrigger={() => callTrigger(triggerEmail)}
            />

            <button
              type="button"
              disabled={isPending || !intakePresent}
              onClick={() => callTrigger(triggerPlanning)}
              title={
                intakePresent
                  ? 'Generate next month\'s plan now → build workbook → email the (pinned) test inbox. Re-runnable.'
                  : 'Enter intake first — planning needs this month\'s answers.'
              }
              className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
            >
              Run planning now
            </button>

            <button
              type="button"
              disabled={isPending || !cycleIsActive}
              onClick={copyLink}
              title={cycleIsActive ? 'Mint a revocable magic link to the client app (app.sprigly.co.uk) for this cycle and copy it.' : 'No cycle yet — run the cycle first.'}
              className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
            >
              Copy client link
            </button>

            <button
              type="button"
              disabled={isPending}
              onClick={() => { setActionError(null); setShowResetConfirm(true); }}
              className="text-xs text-red-400 underline hover:text-red-600 disabled:opacity-50"
            >
              Reset cycle
            </button>
          </div>

          {/* Minted client link */}
          {clientLink && (
            <div className="mt-3 flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              <span className="shrink-0 font-medium">{linkCopied ? 'Copied' : 'Link'}:</span>
              <code className="break-all text-xs text-gray-600">{clientLink}</code>
              <button
                type="button"
                onClick={() => setClientLink(null)}
                className="ml-auto shrink-0 text-gray-400 hover:text-gray-600 text-xs"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* Delivery surface preference */}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">Delivery email links to:</span>
            <select
              defaultValue={deliverySurface}
              disabled={isPending}
              onChange={(e) => callTrigger(setDeliverySurface, { surface: (e.target as unknown as { value: string }).value })}
              className="border border-gray-300 rounded px-2 py-1 text-xs disabled:opacity-50"
            >
              <option value="both">App + workbook (both)</option>
              <option value="app">App only</option>
              <option value="sheet">Workbook only</option>
            </select>
          </div>
        </div>

        {/* Limits & cadence (Phase 4) */}
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Limits &amp; cadence</h3>

          {/* AI-change limit */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium text-gray-600 w-40 shrink-0">AI-change limit / month</span>
            <input
              type="number" min={0} step={1}
              value={aiLimitInput}
              disabled={isPending}
              onChange={(e) => setAiLimitInput((e.target as unknown as { value: string }).value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isPending || aiLimitInput.trim() === '' || aiLimitInput === String(aiChangeLimit)}
              onClick={() => callTrigger(setAiChangeLimit, { limit: aiLimitInput.trim() })}
              className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <span className="text-xs text-gray-400">rewrites/regen only — structural edits are always free</span>
          </div>

          {/* Override */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium text-gray-600 w-40 shrink-0">Override</span>
            {overrideActive ? (
              <>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  Unlimited until {fmtDate(aiChangeLimitOverrideUntil!)}
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => callTrigger(clearAiLimitOverride)}
                  className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
                >
                  Clear override
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-gray-400">Limit in force.</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => callTrigger(liftAiLimit)}
                  className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Lift limit for 30 days
                </button>
              </>
            )}
          </div>

          {/* Posts per week */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium text-gray-600 w-40 shrink-0">Posts per week</span>
            <input
              type="number" min={1} max={14} step={1}
              value={ppwInput}
              placeholder="auto"
              disabled={isPending}
              onChange={(e) => setPpwInput((e.target as unknown as { value: string }).value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-24 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={isPending || ppwInput === (postsPerWeek != null ? String(postsPerWeek) : '')}
              onClick={() => callTrigger(setPostsPerWeek, { postsPerWeek: ppwInput.trim() })}
              className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <span className="text-xs text-gray-400">blank = derive from history/config (unchanged)</span>
          </div>
        </div>

        {/* Start & prepare — run the input-fetch trace for an arbitrary month, stop before planning */}
        <div className="mt-4 pt-4 border-t border-gray-100">
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
              title={`Create/reuse the ${channel} cycle for the chosen plan month and run the input trace (IG trawl → request-email) for its data month. STOPS before planning — check the inputs below, then run planning deliberately. No client is emailed; the John-pinned delivery is untouched.`}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Preparing…' : 'Start & prepare'}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Pick the month you want posts <em>for</em> (e.g. <span className="font-mono">2026-07</span> → July posts, data month <span className="font-mono">2026-06</span>).
            Runs the IG trawl + request, <strong>stops before planning</strong>, and shows what inputs were found so you can fill gaps first.
          </p>

          {/* Inputs found for the picked month's data month — prominent, so gaps are obvious before planning */}
          {startMonthValid && startDataMonth && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Inputs found — data month <span className="font-mono normal-case">{startDataMonth}</span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className={startHasPosts ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{startHasPosts ? '✓' : '✗'}</span>
                  <span className={startHasPosts ? 'text-gray-700' : 'text-red-600 font-medium'}>
                    IG posts <span className="font-mono text-xs text-gray-400">instagram-posts-{startDataMonth}.json</span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className={startHasSales ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{startHasSales ? '✓' : '✗'}</span>
                  <span className={startHasSales ? 'text-gray-700' : 'text-red-600 font-medium'}>
                    Sales data <span className="font-mono text-xs text-gray-400">sales-{startDataMonth}.csv</span>
                  </span>
                </span>
              </div>
              {(!startHasPosts || !startHasSales) && (
                <p className="mt-2 text-xs text-amber-600">
                  Missing inputs won&apos;t block planning, but the plan will be thinner. Prepare fetches IG automatically; drop <span className="font-mono">sales-{startDataMonth}.csv</span> into Drive if absent, then run planning.
                </p>
              )}
              {driveFiles === null && (
                <p className="mt-2 text-xs text-gray-400 italic">Drive file list unavailable — can&apos;t confirm inputs (check Drive OAuth).</p>
              )}
            </div>
          )}

          {startNote && (
            <div className="mt-3 flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
              <span className="shrink-0 font-bold">✓</span>
              <span>{startNote}</span>
              <button
                type="button"
                onClick={() => setStartNote(null)}
                className="ml-auto shrink-0 text-green-500 hover:text-green-700 text-xs"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Inputs & competitors — upload sales/IG, manage competitor list, IG status */}
        <InputsAndCompetitors
          clientId={clientId}
          channel={channel}
          dataMonth={dataMonth}
          competitors={competitors}
          igInputStatus={igInputStatus}
          igInputDetail={igInputDetail}
        />

        {/* Inline action error */}
        {actionError && (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <span className="shrink-0 font-bold">!</span>
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="ml-auto shrink-0 text-red-400 hover:text-red-600 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Cycle-active state note */}
        {cycleIsActive && !actionError && (
          <p className="mt-2 text-xs text-amber-600">
            Cycle is already <strong>{cycle?.status}</strong> for {dataMonth}.
            {cycleIsRequested && ' A draft may already exist.'}
            {' '}Reset first to re-run, or click &quot;Run cycle now&quot; to force.
          </p>
        )}
      </div>

      {/* ── Confirm: trigger when already run ──────────────────────── */}
      {showTriggerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Cycle already run for {dataMonth}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              This cycle is currently <strong>{cycle?.status}</strong>.
              {cycleIsRequested && ' A draft has already been created. '}
              Running again will enqueue a new ig-trawl → request-email chain and may create another draft.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowTriggerConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setShowTriggerConfirm(false); callTrigger(triggerCycle); }}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Run anyway
              </button>
            </div>
          </div>
        </div>
      )}

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
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <form action={resetCycle} onSubmit={() => setShowResetConfirm(false)}>
                <input type="hidden" name="clientId"  value={clientId} />
                <input type="hidden" name="channel"   value={channel} />
                <input type="hidden" name="dataMonth" value={dataMonth} />
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
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

// ── TriggerEmailButton (inline warning state) ─────────────────────────────────

function TriggerEmailButton({
  hasPostsFile,
  isPending,
  onTrigger,
}: {
  hasPostsFile: boolean;
  isPending:    boolean;
  onTrigger:    () => void;
}) {
  const [showWarn, setShowWarn] = useState(false);

  if (!hasPostsFile && !showWarn) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => setShowWarn(true)}
        className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
      >
        Run email only
      </button>
    );
  }

  if (!hasPostsFile && showWarn) {
    return (
      <span className="text-xs text-gray-500">
        No IG data — email will be sales-only.{' '}
        <button
          type="button"
          disabled={isPending}
          onClick={() => { setShowWarn(false); onTrigger(); }}
          className="underline hover:text-gray-700 disabled:opacity-50"
        >
          Proceed
        </button>
        {' '}/{' '}
        <button
          type="button"
          onClick={() => setShowWarn(false)}
          className="underline hover:text-gray-700"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={onTrigger}
      className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
    >
      Run email only
    </button>
  );
}

// ── Inputs & competitors (uploads + list management + IG status) ────────────────

const IG_STATUS_META: Record<string, { text: string; cls: string }> = {
  ok:               { text: 'IG ✓ — trawl succeeded',                       cls: 'bg-green-100 text-green-700' },
  no_key:           { text: 'IG ✗ — never ran (no Apify key)',              cls: 'bg-gray-100 text-gray-600' },
  no_handle:        { text: 'IG ✗ — no Instagram handle set',               cls: 'bg-gray-100 text-gray-600' },
  empty_month:      { text: 'IG ✗ — ran, 0 posts for the month',           cls: 'bg-amber-100 text-amber-700' },
  account_mismatch: { text: 'IG ✗ — handle mismatch (wrong @)',            cls: 'bg-amber-100 text-amber-700' },
  quota_exhausted:  { text: 'IG ✗ — FAILED: Apify credits exhausted (402)', cls: 'bg-red-100 text-red-700' },
  bad_key:          { text: 'IG ✗ — FAILED: bad Apify key (401)',          cls: 'bg-red-100 text-red-700' },
  error:            { text: 'IG ✗ — trawl error',                          cls: 'bg-red-100 text-red-700' },
};

function InputsAndCompetitors({ clientId, channel, dataMonth, competitors, igInputStatus, igInputDetail }: {
  clientId: string; channel: string; dataMonth: string; competitors: string[]; igInputStatus: string | null; igInputDetail: string | null;
}) {
  const [month, setMonth]         = useState(dataMonth);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [igFile, setIgFile]       = useState<File | null>(null);
  const [compHandle, setCompHandle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [busy, startT]  = useTransition();

  const run = (action: (fd: FormData) => Promise<InputActionResult>, fd: FormData, after?: () => void) => {
    setNote(null); setErr(null);
    startT(async () => {
      const r = await action(fd);
      if (r.ok) { setNote(r.message); after?.(); } else setErr(r.message);
    });
  };
  const base = () => { const fd = new FormData(); fd.set('clientId', clientId); fd.set('channel', channel); return fd; };

  const doSales = () => {
    if (!salesFile) { setErr('Choose a CSV file first.'); return; }
    const fd = base(); fd.set('month', month); fd.set('file', salesFile); run(uploadSales, fd);
  };
  const doIg = () => {
    if (!igFile) { setErr('Choose a JSON file first.'); return; }
    const fd = base(); fd.set('month', month); fd.set('file', igFile); run(uploadIgPosts, fd);
  };
  const doAdd = () => { if (!compHandle.trim()) return; const fd = base(); fd.set('handle', compHandle); run(addCompetitor, fd, () => setCompHandle('')); };
  const doRemove = (h: string) => { const fd = base(); fd.set('handle', h); run(removeCompetitor, fd); };

  const overCap = competitors.length > 5;
  const igMeta = igInputStatus ? (IG_STATUS_META[igInputStatus] ?? { text: `IG: ${igInputStatus}`, cls: 'bg-gray-100 text-gray-600' }) : null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Inputs &amp; competitors</h3>

      {/* IG input status (distinct from Drive-file presence) */}
      {igMeta && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 w-32 shrink-0">IG input</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${igMeta.cls}`} title={igInputDetail ?? undefined}>{igMeta.text}</span>
          {igInputDetail && <span className="text-xs text-gray-400 truncate max-w-xs">{igInputDetail}</span>}
        </div>
      )}

      {/* Data month for uploads */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-600 w-32 shrink-0">Upload data month</span>
        <input type="month" value={month} disabled={busy}
          onChange={(e) => setMonth((e.target as unknown as { value: string }).value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50" />
        <span className="text-xs text-gray-400">files land as <span className="font-mono">sales-{month}.csv</span> / <span className="font-mono">instagram-posts-{month}.json</span></span>
      </div>

      {/* Sales upload */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="font-medium text-gray-600 w-32 shrink-0">Sales CSV</span>
        <input type="file" accept=".csv,text/csv" disabled={busy}
          onChange={(e) => setSalesFile((e.target as unknown as { files: ArrayLike<File> | null }).files?.[0] ?? null)}
          className="text-xs" />
        <button type="button" disabled={busy || !salesFile} onClick={doSales}
          className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Upload &amp; rebuild catalogue
        </button>
        <span className="text-xs text-gray-400">Shopify &quot;Sales by product&quot; — writes Drive + rebuilds catalogue</span>
      </div>

      {/* IG fallback upload */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="font-medium text-gray-600 w-32 shrink-0">IG posts JSON</span>
        <input type="file" accept=".json,application/json" disabled={busy}
          onChange={(e) => setIgFile((e.target as unknown as { files: ArrayLike<File> | null }).files?.[0] ?? null)}
          className="text-xs" />
        <button type="button" disabled={busy || !igFile} onClick={doIg}
          className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Upload IG fallback
        </button>
        <span className="text-xs text-gray-400">array of {'{ timestamp, caption?, likesCount, commentsCount }'} — planning reads it</span>
      </div>

      {/* Competitor list */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-600 w-32 shrink-0">Competitors</span>
          <span className="text-xs text-gray-400">{competitors.length}/5 scraped{overCap ? '' : ' — the gather scrapes at most 5'}</span>
        </div>
        {overCap && (
          <div className="ml-32 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            {competitors.length} configured — only the first 5 are scraped. Trim to your top 5 (remove {competitors.length - 5}).
          </div>
        )}
        <div className="ml-32 flex flex-wrap gap-1.5">
          {competitors.length === 0 && <span className="text-xs text-gray-400">None yet.</span>}
          {competitors.map((h, i) => (
            <span key={h} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${i < 5 ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-700 line-through'}`}>
              @{h}
              <button type="button" disabled={busy} onClick={() => doRemove(h)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${h}`}>✕</button>
            </span>
          ))}
        </div>
        <div className="ml-32 flex items-center gap-2">
          <input type="text" value={compHandle} placeholder="@handle" disabled={busy || competitors.length >= 5}
            onChange={(e) => setCompHandle((e.target as unknown as { value: string }).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-48 disabled:opacity-50" />
          <button type="button" disabled={busy || !compHandle.trim() || competitors.length >= 5} onClick={doAdd}
            className="px-2.5 py-1 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed">
            Add
          </button>
          {competitors.length >= 5 && <span className="text-xs text-gray-400">Max 5 — remove one to add another.</span>}
        </div>
      </div>

      {note && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">✓</span><span>{note}</span>
          <button type="button" onClick={() => setNote(null)} className="ml-auto shrink-0 text-green-500 hover:text-green-700 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
      {err && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <span className="shrink-0 font-bold">!</span><span>{err}</span>
          <button type="button" onClick={() => setErr(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600 text-xs" aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}
