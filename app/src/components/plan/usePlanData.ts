'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanPost, CycleSummary, PostStepView, ShapeResult } from '@/lib/types';
import type { ProposalView } from '@/lib/agent/types';
import type { NoteView } from '@/lib/agent/notes';

export interface AgentReply { message: string; proposals: ProposalView[] }
interface AgentTurn { conversationId: string; message: string; proposals?: ProposalView[] }

export interface PlanDataInit {
  posts: PlanPost[];
  cycles: CycleSummary[];
  homeCycleId: string;
  today: string;
  clientName: string;
}

/** The one shared state + data layer for both layouts. All writes hit the endpoints
 *  confirmed in AUDIT.md + Stage 1's steps API; nothing re-fetches for rings/Tasks
 *  (steps arrive batched on PlanPost). */
export function usePlanData(init: PlanDataInit) {
  const [posts, setPosts] = useState<PlanPost[]>(init.posts);
  const [cycles, setCycles] = useState<CycleSummary[]>(init.cycles);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [viewedCycleId, setViewedCycleId] = useState(init.homeCycleId);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [shapingIds, setShapingIds] = useState<Set<string>>(new Set());
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState<AgentReply | null>(null);
  const [flashView, setFlashView] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshProposals = useCallback(async () => {
    try { const r = await fetch('/api/plan/proposals?status=pending'); if (r.ok) setProposals(((await r.json()) as { proposals: ProposalView[] }).proposals); } catch { /* non-fatal */ }
  }, []);
  const refreshNotes = useCallback(async () => {
    try { const r = await fetch('/api/plan/notes'); if (r.ok) setNotes(((await r.json()) as { notes: NoteView[] }).notes); } catch { /* non-fatal */ }
  }, []);
  const refreshPlan = useCallback(async () => {
    try { const r = await fetch('/api/plan'); if (r.ok) setPosts(((await r.json()) as { posts: PlanPost[] }).posts); } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void refreshProposals(); void refreshNotes(); }, [refreshProposals, refreshNotes]);

  /** Structural write → swap in the returned post set. No-op in a read-only cycle. */
  const call = useCallback(async (url: string, method: string, payload?: unknown): Promise<void> => {
    if (readOnly) return;
    setBusy(true);
    try {
      const init2: RequestInit = { method };
      if (payload !== undefined) { init2.headers = { 'content-type': 'application/json' }; init2.body = JSON.stringify(payload); }
      const res = await fetch(url, init2);
      if (!res.ok) { flash('Something went wrong — please try again.'); return; }
      const r = (await res.json()) as ShapeResult;
      if (r.mode === 'applied') { setPosts(r.posts); flash(r.summary); }
    } catch { flash('Network error — please try again.'); }
    finally { setBusy(false); }
  }, [readOnly, flash]);

  const reschedule = useCallback((id: string, dateIso: string) => call(`/api/posts/${id}`, 'PATCH', { date: dateIso }), [call]);
  const saveCaption = useCallback((id: string, caption: string) => call(`/api/posts/${id}`, 'PATCH', { caption }), [call]);
  const revert = useCallback((id: string) => call(`/api/posts/${id}/revert`, 'POST'), [call]);
  const removePost = useCallback((id: string) => call(`/api/posts/${id}`, 'DELETE'), [call]);
  const addPost = useCallback((dateIso: string) => call('/api/posts', 'POST', { date: dateIso }), [call]);

  /** Merge a fresh steps array for one post into local state (steps endpoints return
   *  { steps } for that post). */
  const setPostSteps = useCallback((postId: string, steps: PostStepView[]) => {
    setPosts((cur) => cur.map((p) => (p.id === postId ? { ...p, steps } : p)));
  }, []);

  const generateChecklist = useCallback(async (id: string) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/checklist/generate`, { method: 'POST' });
      if (res.status === 409) { flash('This post already has a checklist.'); return; }
      if (res.status === 422) { flash('No checklist for this format.'); return; }
      if (!res.ok) { flash('Could not build the checklist.'); return; }
      setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
      flash('Checklist added.');
    } catch { flash('Network error — please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  const addStep = useCallback(async (id: string, input: { label: string; leadDays: number }) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (res.ok) setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
    } catch { flash('Network error — please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  const toggleStep = useCallback(async (id: string, stepId: string, done: boolean) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/steps/${stepId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }) });
      if (res.ok) setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
    } catch { flash('Network error — please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  /** Poll a shape job until it settles, then swap posts in. */
  const pollJob = useCallback(async (jobId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1600));
      let j: { status: string; posts?: PlanPost[]; summary?: string };
      try { const res = await fetch(`/api/jobs/${jobId}`); if (!res.ok) continue; j = (await res.json()) as typeof j; } catch { continue; }
      if (j.status === 'done') { if (j.posts) setPosts(j.posts); flash(j.summary ?? 'Updated the caption.'); return; }
      if (j.status === 'error') { flash(j.summary ?? 'Could not make that change — left it as it was.'); return; }
      if (j.status === 'gone') { await refreshPlan(); return; }
    }
    flash('Still working — give it a moment, then refresh.');
  }, [flash, refreshPlan]);

  /** "Shape this post": async via the shape job (deviation 3). Marks the post pending
   *  rather than mutating the caption; completion arrives on the next data refresh. */
  const shape = useCallback(async (id: string, instruction: string) => {
    if (readOnly || !instruction.trim() || shapingIds.has(id)) return;
    setShapingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/posts/${id}/shape`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }) });
      if (!res.ok) { flash('Could not start that change — please try again.'); return; }
      const r = (await res.json()) as { mode?: string; summary?: string; jobId?: string };
      if (r.mode === 'blocked') { flash(r.summary ?? 'You’ve reached this month’s AI-change limit.'); return; }
      if (r.mode === 'pending' && r.jobId) { flash(r.summary ?? 'Sprigly is rewriting this…'); await pollJob(r.jobId); }
    } catch { flash('Network error — please try again.'); }
    finally { setShapingIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [readOnly, shapingIds, flash, pollJob]);

  /** Talk to your plan → real agent extraction; proposals land in Approvals. */
  const ask = useCallback(async (instruction: string, selectedPostId: string | null): Promise<AgentReply | null> => {
    if (readOnly || !instruction.trim() || agentBusy) return null;
    setAgentBusy(true);
    try {
      const res = await fetch('/api/plan/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction, selectedPostId, conversationId: conversationId.current }),
      });
      if (!res.ok) { flash('Something went wrong — please try again.'); return null; }
      const r = (await res.json()) as AgentTurn;
      conversationId.current = r.conversationId;
      const created = r.proposals ?? [];
      const reply: AgentReply = { message: r.message, proposals: created };
      setAgentReply(reply);
      if (created.length) {
        setProposals((cur) => [...created.filter((p) => !cur.some((c) => c.id === p.id)), ...cur]);
        setFlashView('approvals'); setTimeout(() => setFlashView(null), 2800);
      } else { flash(r.message); }
      void refreshNotes();
      return reply;
    } catch { flash('Network error — please try again.'); return null; }
    finally { setAgentBusy(false); }
  }, [readOnly, agentBusy, flash, refreshNotes]);

  const decide = useCallback(async (id: string, action: 'approve' | 'reject') => {
    if (proposalBusy) return;
    setProposalBusy(id);
    try {
      const res = await fetch(`/api/plan/proposals/${id}/${action}`, { method: 'POST' });
      if (!res.ok) { flash('Could not update that — please try again.'); return; }
      const d = (await res.json()) as { jobId?: string };
      setProposals((cur) => cur.filter((p) => p.id !== id));
      if (action === 'approve') {
        flash('Change approved.');
        await refreshPlan();
        if (d.jobId) { await pollJob(d.jobId); await refreshPlan(); }
      } else { flash('Dismissed.'); }
    } catch { flash('Network error — please try again.'); }
    finally { setProposalBusy(null); }
  }, [proposalBusy, flash, refreshPlan, pollJob]);

  /** Switch the rendered cycle (read-only for non-home). */
  const switchCycle = useCallback(async (cycleId: string) => {
    setSwitching(true);
    try {
      const isHome = cycleId === init.homeCycleId;
      const res = await fetch(isHome ? '/api/plan' : `/api/plan?cycleId=${encodeURIComponent(cycleId)}`);
      if (!res.ok) { flash('Could not open that month.'); return; }
      const d = (await res.json()) as { posts: PlanPost[]; readOnly: boolean };
      setPosts(d.posts); setReadOnly(!!d.readOnly); setViewedCycleId(cycleId);
    } catch { flash('Network error — please try again.'); }
    finally { setSwitching(false); }
  }, [init.homeCycleId, flash]);

  return {
    // data
    posts, cycles, proposals, notes, today: init.today, clientName: init.clientName,
    homeCycleId: init.homeCycleId, viewedCycleId, readOnly,
    // status
    busy, switching, shapingIds, proposalBusy, agentBusy, agentReply, flashView, toast,
    // actions
    reschedule, saveCaption, revert, removePost, addPost,
    generateChecklist, addStep, toggleStep, shape, ask, decide, switchCycle,
    setAgentReply, flash,
  };
}

export type PlanData = ReturnType<typeof usePlanData>;
