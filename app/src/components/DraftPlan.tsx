'use client';

/**
 * DraftPlan — client shell for the draft surface. (Build B)
 *
 * Owns exactly one thing the view should not: the network call. Every mutation goes to
 * POST /api/plan/draft, which re-derives the client from the session and re-checks the
 * draft + cutoff guards server-side. The surface never sends a clientId and could not
 * usefully forge one.
 *
 * The route returns the authoritative beat list on success, so the view replaces its state
 * from the server rather than predicting the outcome. That matches how the plan surface
 * already handles structural edits, and it means a rejected mutation can never leave the
 * client showing a change that did not happen.
 */
import React from 'react';
import { DraftPlanView, type DraftReceipt } from './plan/DraftPlanView';
import type { DraftBeatView, CycleSummary } from '@/lib/types';

export interface DraftPlanProps {
  beats:      DraftBeatView[];
  monthLabel: string;
  clientName: string;
  pillars:    string[];
  editable:   boolean;
  receipts:   DraftReceipt[];
  /** Month navigation. Present when the draft renders inside PlanRoot (which owns the
   *  switch); absent on the standalone legacy render, which has no switcher and never had.
   *  Without it a client who lands on a draft has no way to look at any other month. */
  cycles?:        CycleSummary[];
  viewedCycleId?: string;
  /** The cycle being reviewed, for the post-approval landing. Defaults to viewedCycleId. */
  cycleId?:       string;
  onSwitchCycle?: (cycleId: string) => void;
  switching?:     boolean;
}

export function DraftPlan(props: DraftPlanProps) {
  async function onMutate(op: Record<string, unknown>) {
    try {
      const res = await fetch('/api/plan/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });
      const json = (await res.json()) as { ok?: boolean; beats?: DraftBeatView[]; message?: string; dropped?: Record<string, unknown> };
      if (!res.ok || !json.ok) {
        return { ok: false, message: json.message ?? 'That didn’t work. Try again?' };
      }
      // `dropped` is the full removed beat — the view holds it so undo can restore it
      // verbatim rather than re-adding a skeleton.
      return json.dropped
        ? { ok: true, beats: json.beats ?? [], dropped: json.dropped }
        : { ok: true, beats: json.beats ?? [] };
    } catch {
      // A network failure must read as a network failure, not as a rejected edit — the
      // client should retry, not assume we refused them.
      return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
    }
  }

  async function onSay(text: string) {
    try {
      const res = await fetch('/api/plan/draft/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'text', text }),
      });
      const json = (await res.json()) as { ok?: boolean; application?: DraftReceipt; beats?: DraftBeatView[]; message?: string };
      if (!res.ok || !json.ok) return { ok: false, message: json.message ?? 'That didn’t work. Try again?' };
      // exactOptionalPropertyTypes: only include `application` when we actually have one,
      // rather than passing an explicit undefined the prop type does not admit.
      return json.application
        ? { ok: true, application: json.application, beats: json.beats ?? [] }
        : { ok: true, beats: json.beats ?? [] };
    } catch {
      return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
    }
  }

  /**
   * The rescue tap Build C specified and never wired.
   *
   * The server op has always existed (api/plan/draft/apply/route.ts:49); nothing ever sent
   * it, so an evergreen receipt told the client to "add it from your ideas" on a surface
   * with no such control. Routes through the SAME transform path as a typed input, so a
   * rescued idea lands and displaces exactly as if they had just written it.
   */
  async function onAddToMonth(planInputId: string, date: string) {
    try {
      const res = await fetch('/api/plan/draft/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'add_to_month', planInputId, date }),
      });
      const json = (await res.json()) as { ok?: boolean; application?: DraftReceipt; beats?: DraftBeatView[]; message?: string };
      if (!res.ok || !json.ok) return { ok: false, message: json.message ?? 'That didn’t work. Try again?' };
      return json.application
        ? { ok: true, application: json.application, beats: json.beats ?? [] }
        : { ok: true, beats: json.beats ?? [] };
    } catch {
      return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
    }
  }

  async function onApprove() {
    try {
      const res = await fetch('/api/plan/draft/approve', { method: 'POST' });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) return { ok: false, message: json.message ?? 'We couldn’t start that. Try again?' };
      return { ok: true };
    } catch {
      return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
    }
  }

  const { cycles, viewedCycleId, onSwitchCycle } = props;
  const others = cycles && viewedCycleId
    ? [...cycles].sort((a, b) => b.displayMonth.localeCompare(a.displayMonth))
    : [];

  return (
    <>
      {others.length > 1 && onSwitchCycle && (
        <nav aria-label="Choose a month" data-testid="draft-month-nav" style={NAV}>
          {others.map((c) => (
            <button
              key={c.cycleId}
              type="button"
              data-testid={`draft-month-${c.cycleId}`}
              aria-current={c.cycleId === viewedCycleId ? 'true' : undefined}
              disabled={props.switching || c.cycleId === viewedCycleId}
              onClick={() => onSwitchCycle(c.cycleId)}
              style={c.cycleId === viewedCycleId ? NAV_ON : NAV_OFF}
            >
              {c.monthLabel}
            </button>
          ))}
        </nav>
      )}
      {/* Keyed by cycle so the view RE-SEEDS from the new month's beats: DraftPlanView
          holds its beats in local state (DraftPlanView.tsx:69), so without a remount a
          client returning to a draft month would see the month they left. */}
      <DraftPlanView
        key={viewedCycleId ?? 'draft'}
        cycleId={props.cycleId ?? viewedCycleId}
        beats={props.beats}
        monthLabel={props.monthLabel}
        clientName={props.clientName}
        pillars={props.pillars}
        editable={props.editable}
        receipts={props.receipts}
        onMutate={onMutate}
        onSay={onSay}
        onAddToMonth={onAddToMonth}
        onApprove={onApprove}
      />
    </>
  );
}

const NAV: React.CSSProperties = {
  display: 'flex', gap: 8, flexWrap: 'wrap',
  padding: '12px 16px 0', background: '#F8F9FB',
};
const NAV_BASE: React.CSSProperties = {
  border: '1.5px solid #E8EAEE', borderRadius: 999, padding: '6px 14px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#FFFFFF', color: '#5B647A',
};
const NAV_ON:  React.CSSProperties = { ...NAV_BASE, background: '#1E2A4A', color: '#FFFFFF', borderColor: '#1E2A4A', cursor: 'default' };
const NAV_OFF: React.CSSProperties = NAV_BASE;
