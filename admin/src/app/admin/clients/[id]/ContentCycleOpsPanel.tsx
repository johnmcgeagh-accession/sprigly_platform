'use client';

import { useState, useTransition } from 'react';
import {
  triggerCycle,
  triggerTrawl,
  triggerEmail,
  triggerPlanning,
  resetCycle,
  copyClientLink,
  setDeliverySurface,
  type ActionResult,
} from './actions';
import { formatDateTime, formatDateTimeShort } from '@/lib/format-date';

interface DriveFileMeta {
  id:           string;
  name:         string;
  mimeType:     string;
  modifiedTime: string;
}

interface CycleInfo {
  status:        string;
  requestSentAt: string | null;  // ISO string (Date serialised from server)
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
  intakePresent:       boolean;  // planContent answers/freeNotes present → planning can run
  driveFiles:          DriveFileMeta[] | null;  // null = fetch failed / no tokens
  driveError:          boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Deterministic, hydration-safe formatters (see @/lib/format-date).
const fmtDate = formatDateTime;
const fmtModified = formatDateTimeShort;

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
  intakePresent,
  driveFiles,
  driveError,
}: Props) {
  const [showResetConfirm,   setShowResetConfirm]   = useState(false);
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
  const [actionError,        setActionError]         = useState<string | null>(null);
  const [clientLink,         setClientLink]          = useState<string | null>(null);
  const [linkCopied,         setLinkCopied]          = useState(false);
  const [isPending,          startTransition]        = useTransition();

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
