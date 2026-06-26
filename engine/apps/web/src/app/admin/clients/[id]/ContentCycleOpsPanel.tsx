'use client';

import { useState } from 'react';
import {
  triggerCycle,
  triggerTrawl,
  triggerEmail,
  resetCycle,
} from './actions';

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
  driveFiles:          DriveFileMeta[] | null;  // null = fetch failed / no tokens
  driveError:          boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtModified(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
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
  driveFiles,
  driveError,
}: Props) {
  const [showResetConfirm,  setShowResetConfirm]  = useState(false);
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);

  const salesFile = `sales-${dataMonth}.csv`;
  const postsFile = `instagram-posts-${dataMonth}.json`;

  const hasSalesFile = driveFiles?.some(f => f.name.toLowerCase() === salesFile.toLowerCase()) ?? false;
  const hasPostsFile = driveFiles?.some(f => f.name.toLowerCase() === postsFile.toLowerCase()) ?? false;

  const cycleIsActive = cycle !== null && cycle.status !== 'scheduled';
  const cycleIsRequested = cycle?.status === 'requested';

  function handleTriggerClick() {
    setShowTriggerConfirm(true);
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
          <form id={`trigger-form-${clientId}`} action={triggerCycle}>
            <input type="hidden" name="clientId"  value={clientId} />
            <input type="hidden" name="channel"   value={channel} />
            <input type="hidden" name="dataMonth" value={dataMonth} />
            <button
              type={cycleIsActive ? 'button' : 'submit'}
              onClick={cycleIsActive ? handleTriggerClick : undefined}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Run cycle now
            </button>
          </form>

          {/* POWER TOOLS — visually subordinate */}
          <div className="flex items-center gap-3 ml-2 pl-3 border-l border-gray-200">
            <span className="text-xs text-gray-400">Power tools:</span>

            <form action={triggerTrawl}>
              <input type="hidden" name="clientId"  value={clientId} />
              <input type="hidden" name="channel"   value={channel} />
              <input type="hidden" name="dataMonth" value={dataMonth} />
              <button
                type="submit"
                className="text-xs text-gray-500 underline hover:text-gray-700"
              >
                Run trawl only
              </button>
            </form>

            <TriggerEmailButton
              clientId={clientId}
              channel={channel}
              dataMonth={dataMonth}
              hasPostsFile={hasPostsFile}
            />

            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-red-400 underline hover:text-red-600"
            >
              Reset cycle
            </button>
          </div>
        </div>

        {/* Cycle-active state note */}
        {cycleIsActive && (
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
              <form action={triggerCycle} onSubmit={() => setShowTriggerConfirm(false)}>
                <input type="hidden" name="clientId"  value={clientId} />
                <input type="hidden" name="channel"   value={channel} />
                <input type="hidden" name="dataMonth" value={dataMonth} />
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Run anyway
                </button>
              </form>
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

// ── TriggerEmailButton (extracted for warning state) ──────────────────────────

function TriggerEmailButton({
  clientId,
  channel,
  dataMonth,
  hasPostsFile,
}: {
  clientId:     string;
  channel:      string;
  dataMonth:    string;
  hasPostsFile: boolean;
}) {
  const [showWarn, setShowWarn] = useState(false);

  if (!hasPostsFile && !showWarn) {
    return (
      <button
        type="button"
        onClick={() => setShowWarn(true)}
        className="text-xs text-gray-500 underline hover:text-gray-700"
      >
        Run email only
      </button>
    );
  }

  if (!hasPostsFile && showWarn) {
    return (
      <span className="text-xs text-gray-500">
        No IG data — email will be sales-only.{' '}
        <form action={triggerEmail} className="inline">
          <input type="hidden" name="clientId"  value={clientId} />
          <input type="hidden" name="channel"   value={channel} />
          <input type="hidden" name="dataMonth" value={dataMonth} />
          <button type="submit" className="underline hover:text-gray-700">Proceed</button>
        </form>
        {' '}/<button
          type="button"
          onClick={() => setShowWarn(false)}
          className="underline hover:text-gray-700"
        >Cancel</button>
      </span>
    );
  }

  return (
    <form action={triggerEmail}>
      <input type="hidden" name="clientId"  value={clientId} />
      <input type="hidden" name="channel"   value={channel} />
      <input type="hidden" name="dataMonth" value={dataMonth} />
      <button type="submit" className="text-xs text-gray-500 underline hover:text-gray-700">
        Run email only
      </button>
    </form>
  );
}
