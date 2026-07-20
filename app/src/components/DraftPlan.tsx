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
import { DraftPlanView } from './plan/DraftPlanView';
import type { DraftBeatView } from '@/lib/types';

export interface DraftPlanProps {
  beats:      DraftBeatView[];
  monthLabel: string;
  clientName: string;
  pillars:    string[];
  editable:   boolean;
}

export function DraftPlan(props: DraftPlanProps) {
  async function onMutate(op: Record<string, unknown>) {
    try {
      const res = await fetch('/api/plan/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });
      const json = (await res.json()) as { ok?: boolean; beats?: DraftBeatView[]; message?: string };
      if (!res.ok || !json.ok) {
        return { ok: false, message: json.message ?? 'That didn’t work. Try again?' };
      }
      return { ok: true, beats: json.beats ?? [] };
    } catch {
      // A network failure must read as a network failure, not as a rejected edit — the
      // client should retry, not assume we refused them.
      return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' };
    }
  }

  return (
    <DraftPlanView
      beats={props.beats}
      monthLabel={props.monthLabel}
      clientName={props.clientName}
      pillars={props.pillars}
      editable={props.editable}
      onMutate={onMutate}
    />
  );
}
