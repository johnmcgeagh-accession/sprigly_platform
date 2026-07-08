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
  const [agentError, setAgentError] = useState<string | null>(null);
  const [shapeErrors, setShapeErrors] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<null | 'proposals' | 'notes'>(null);
  const lastShapeInstruction = useRef<Map<string, string>>(new Map());
  const [flashView, setFlashView] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  /** Fire-and-forget UI telemetry (ui_events). Never blocks or throws. */
  const track = useCallback((event: string, payload?: Record<string, unknown>) => {
    void fetch('/api/plan/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, payload }) }).catch(() => {});
  }, []);

  const refreshProposals = useCallback(async () => {
    try {
      const r = await fetch('/api/plan/proposals?status=pending');
      if (!r.ok) throw new Error(String(r.status));
      setProposals(((await r.json()) as { proposals: ProposalView[] }).proposals);
      setLoadError((e) => (e === 'proposals' ? null : e));
    } catch { setLoadError('proposals'); }
  }, []);
  const refreshNotes = useCallback(async () => {
    try {
      const r = await fetch('/api/plan/notes');
      if (!r.ok) throw new Error(String(r.status));
      setNotes(((await r.json()) as { notes: NoteView[] }).notes);
      setLoadError((e) => (e === 'notes' ? null : e));
    } catch { setLoadError('notes'); }
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
      if (res.ok) { setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps); if (done) track('checklist_step_completed', { postId: id, stepId }); }
    } catch { flash('Network error — please try again.'); }
  }, [readOnly, flash, setPostSteps, track]);

  /** Poll a shape job until it settles; returns the terminal status. */
  const pollJob = useCallback(async (jobId: string): Promise<'done' | 'error' | 'gone' | 'timeout'> => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1600));
      let j: { status: string; posts?: PlanPost[]; summary?: string };
      try { const res = await fetch(`/api/jobs/${jobId}`); if (!res.ok) continue; j = (await res.json()) as typeof j; } catch { continue; }
      if (j.status === 'done') { if (j.posts) setPosts(j.posts); flash(j.summary ?? 'Updated the caption.'); return 'done'; }
      if (j.status === 'error') { return 'error'; }
      if (j.status === 'gone') { await refreshPlan(); return 'gone'; }
    }
    return 'timeout';
  }, [flash, refreshPlan]);

  const clearShapeError = useCallback((id: string) => {
    setShapeErrors((m) => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n; });
  }, []);

  /** "Shape this post": async via the shape job (deviation 3). Marks the post pending
   *  rather than mutating the caption; a job failure resolves to a per-post error note
   *  with retry (never a stuck spinner). */
  const shape = useCallback(async (id: string, instruction: string) => {
    if (readOnly || !instruction.trim() || shapingIds.has(id)) return;
    lastShapeInstruction.current.set(id, instruction);
    clearShapeError(id);
    track('shape_requested', { postId: id });
    setShapingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/posts/${id}/shape`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }) });
      if (!res.ok) { setShapeErrors((m) => new Map(m).set(id, 'Couldn’t start that rewrite.')); return; }
      const r = (await res.json()) as { mode?: string; summary?: string; jobId?: string };
      if (r.mode === 'blocked') { flash(r.summary ?? 'You’ve reached this month’s AI-change limit.'); return; }
      if (r.mode === 'noop') { flash(r.summary ?? 'Still finishing the last change to this post.'); return; }
      if (r.mode === 'pending' && r.jobId) {
        flash(r.summary ?? 'Sprigly is rewriting this…');
        const status = await pollJob(r.jobId);
        if (status === 'error' || status === 'timeout') {
          setShapeErrors((m) => new Map(m).set(id, status === 'timeout' ? 'That’s taking longer than expected.' : 'Couldn’t make that change — left it as it was.'));
        }
      }
    } catch { setShapeErrors((m) => new Map(m).set(id, 'Network error — please try again.')); }
    finally { setShapingIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [readOnly, shapingIds, flash, pollJob, clearShapeError, track]);

  /** Retry the last shape instruction for a post. */
  const retryShape = useCallback((id: string) => {
    const instr = lastShapeInstruction.current.get(id);
    if (instr) void shape(id, instr);
  }, [shape]);

  /** Talk to your plan → real agent extraction; proposals land in Approvals. */
  const ask = useCallback(async (instruction: string, selectedPostId: string | null): Promise<AgentReply | null> => {
    if (readOnly || !instruction.trim() || agentBusy) return null;
    setAgentBusy(true);
    setAgentError(null);
    try {
      const res = await fetch('/api/plan/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction, selectedPostId, conversationId: conversationId.current }),
      });
      if (res.status === 429) { setAgentError('You’re sending changes too quickly — give it a few seconds and try again.'); return null; }
      if (!res.ok) { setAgentError('Something went wrong — your message is still here, try again.'); return null; }
      const r = (await res.json()) as AgentTurn;
      conversationId.current = r.conversationId;
      const created = r.proposals ?? [];
      const reply: AgentReply = { message: r.message, proposals: created };
      setAgentReply(reply);
      if (created.length) {
        setProposals((cur) => [...created.filter((p) => !cur.some((c) => c.id === p.id)), ...cur]);
        setFlashView('approvals'); setTimeout(() => setFlashView(null), 2800);
      } else { flash(r.message); }
      track('agent_ask_submitted', { proposals: created.length });
      void refreshNotes();
      return reply;
    } catch { setAgentError('Network error — your message is still here, try again.'); return null; }
    finally { setAgentBusy(false); }
  }, [readOnly, agentBusy, flash, refreshNotes, track]);

  const decide = useCallback(async (id: string, action: 'approve' | 'reject') => {
    if (proposalBusy) return;
    setProposalBusy(id);
    try {
      const res = await fetch(`/api/plan/proposals/${id}/${action}`, { method: 'POST' });
      if (!res.ok) { flash('Could not update that — please try again.'); return; }
      const d = (await res.json()) as { jobId?: string };
      setProposals((cur) => cur.filter((p) => p.id !== id));
      track(action === 'approve' ? 'proposal_approved' : 'proposal_discarded', { id });
      if (action === 'approve') {
        flash('Change approved.');
        await refreshPlan();
        if (d.jobId) { await pollJob(d.jobId); await refreshPlan(); }
      } else { flash('Dismissed.'); }
    } catch { flash('Network error — please try again.'); }
    finally { setProposalBusy(null); }
  }, [proposalBusy, flash, refreshPlan, pollJob, track]);

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
    busy, switching, shapingIds, proposalBusy, agentBusy, agentReply, agentError,
    shapeErrors, loadError, flashView, toast,
    // actions
    reschedule, saveCaption, revert, removePost, addPost,
    generateChecklist, addStep, toggleStep, shape, retryShape, ask, decide, switchCycle,
    refreshProposals, refreshNotes, setAgentReply, setAgentError, flash, track,
  };
}

export type PlanData = ReturnType<typeof usePlanData>;
