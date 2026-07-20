'use client';

import { canAddPost } from '@/lib/add-policy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanPost, PlanBeat, PlanIntake, DurableItemView, CycleSummary, PostStepView, ShapeResult, ExtractedSummary, IntakeResult } from '@/lib/types';
import type { ProposalView } from '@/lib/agent/types';
import type { NoteView } from '@/lib/agent/notes';
import { indexForecast, type WeatherDay, type WeatherWireDay } from '@/lib/weather';
import { resolveDayCycleId } from '@/lib/cycle-nav';
import { planMoveGuard, shouldReconcile } from '@/lib/plan-move';

export interface AgentReply { message: string; proposals: ProposalView[] }

/** Which field a Shape/refine instruction targets (§26). */
export type ShapeTarget = 'caption' | 'hook' | 'script';
interface AgentTurn { conversationId: string; message: string; proposals?: ProposalView[] }

export interface PlanDataInit {
  posts: PlanPost[];
  // Other cycles' posts dated within the viewed cycle's plan month — the calendar grid is
  // date-authoritative and renders posts ∪ crossMonthPosts by date (see loadCrossMonthPosts).
  crossMonthPosts: PlanPost[];
  // Dated content beats (structured_brief.schedule) for the viewed month — read-only markers,
  // not posts. May be empty when the brief is null (pre-extraction).
  beats: PlanBeat[];
  cycles: CycleSummary[];
  homeCycleId: string;
  today: string;
  clientName: string;
  // Intake capture (Build 3): the guided question source (BASE + extra) and whether to open
  // the intake surface on landing (from the Ask email's {{intakeLink}} ?intake=1).
  questions: string[];
  initialIntakeOpen?: boolean | undefined;
  // FIX 1 (Build 5): the viewed cycle's saved intake (form pre-fill) + the client's active
  // durable items (read-only "remembered" list).
  intake: PlanIntake;
  durable: DurableItemView[];
  // Auto-run cutoff day-of-month (client schedule), or null when unconfigured — drives the
  // "Save brief" confirmation copy (a real date vs the neutral message).
  cutoffDay?: number | null;
  // Landing overrides (empty-home-cycle guard): the cycle initially rendered and
  // whether it's read-only. Default to the home cycle / editable when unset.
  initialViewedCycleId?: string | undefined;
  initialReadOnly?: boolean | undefined;
}

/** The one shared state + data layer for both layouts. All writes hit the endpoints
 *  confirmed in AUDIT.md + Stage 1's steps API; nothing re-fetches for rings/Tasks
 *  (steps arrive batched on PlanPost). */
export function usePlanData(init: PlanDataInit) {
  const [posts, setPosts] = useState<PlanPost[]>(init.posts);
  const [crossMonthPosts, setCrossMonthPosts] = useState<PlanPost[]>(init.crossMonthPosts);
  // Optimistic drag/swipe moves: a post being reschedule-synced is "pending" — the card has already
  // moved locally while the write + reconcile run. A post stays non-draggable while pending, so a
  // second drag on the SAME card can't race (different cards move independently). pendingRef mirrors
  // the state for synchronous reads inside the async sync (state updates are async).
  const [pendingMoves, setPendingMoves] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const setPending = useCallback((mut: (s: Set<string>) => void) => {
    const n = new Set(pendingRef.current); mut(n); pendingRef.current = n; setPendingMoves(n);
  }, []);
  const [beats, setBeats] = useState<PlanBeat[]>(init.beats);
  const [intake, setIntake] = useState<PlanIntake>(init.intake);
  const [durable, setDurable] = useState<DurableItemView[]>(init.durable);
  const [cycles, setCycles] = useState<CycleSummary[]>(init.cycles);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [viewedCycleId, setViewedCycleId] = useState(init.initialViewedCycleId ?? init.homeCycleId);
  // DATE POLICY: editability is per-post by scheduled_date (>= today London) across ALL of
  // the client's months — NOT whole-cycle. The old whole-cycle `readOnly` flag is
  // superseded (kept at `false` so every month is browsable AND editable); the per-day
  // `canEdit` gate decides each affordance. `today` is server-computed (init.today,
  // London) — the client clock is never trusted for the gate.
  const readOnly = false;
  const canEdit = useCallback((dateIso: string | undefined) => canAddPost(dateIso, init.today), [init.today]);
  // The cycle that represents "today" — the SAME rule the server landing uses
  // (resolveDayCycleId), so the Today button and the initial landing never diverge.
  const todayCycleId = useMemo(() => resolveDayCycleId(cycles, init.today), [cycles, init.today]);
  // The calendar grid renders BY DATE across cycles: the viewed cycle's own posts plus the
  // cross-cycle posts dated in this month. Each post carries its own cycleId (edit routing
  // is date+client based). The grid buckets by day, so viewed-cycle posts dated OUTSIDE the
  // month simply don't land in any cell; no post appears in more than one month's grid.
  const calendarPosts = useMemo(() => [...posts, ...crossMonthPosts], [posts, crossMonthPosts]);
  // Beats bucketed by ISO date for the calendar (read-only markers; independent of posts).
  // Every beat — single-day OR range — renders ONCE, on its placement day (`beat.date`).
  // Ranges are no longer expanded across days (continuation bands were removed after live
  // review); the labelled pill on the start day carries the full span in its suffix.
  const beatsByDate = useMemo(() => {
    const m = new Map<string, PlanBeat[]>();
    for (const b of beats) { const a = m.get(b.date) ?? []; a.push(b); m.set(b.date, a); }
    return m;
  }, [beats]);
  const beatsOn = useCallback((dateIso: string) => beatsByDate.get(dateIso) ?? [], [beatsByDate]);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Intake capture (Build 3): the guided-form surface open state + in-flight guard.
  const [intakeOpen, setIntakeOpen] = useState(init.initialIntakeOpen ?? false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [shapingIds, setShapingIds] = useState<Set<string>>(new Set());
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState<AgentReply | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [shapeErrors, setShapeErrors] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<null | 'proposals' | 'notes'>(null);
  const lastShapeInstruction = useRef<Map<string, { instruction: string; target: ShapeTarget }>>(new Map());
  // Hook generation (Stage 6): per-post generating flag, returned candidates, and errors.
  const [hookGenerating, setHookGenerating] = useState<Set<string>>(new Set());
  const [hookCandidates, setHookCandidates] = useState<Map<string, string[]>>(new Map());
  const [hookError, setHookError] = useState<Map<string, string>>(new Map());
  // Script generation (Stage 6, reels): per-post generating flag + errors.
  const [scriptGenerating, setScriptGenerating] = useState<Set<string>>(new Set());
  const [scriptError, setScriptError] = useState<Map<string, string>>(new Map());
  const [flashView, setFlashView] = useState<string | null>(null);
  // Weather overlay (Slice 4): a date→forecast map. Pure decoration — fetched in
  // parallel after mount, never blocks render, and stays empty on any failure.
  const [weather, setWeather] = useState<Map<string, WeatherDay>>(new Map());
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
  // Re-fetch the CURRENT view (viewed cycle) and refresh BOTH sets, so a write that moves a
  // post across the month boundary (or edits a cross-cycle post) is reflected in the grid.
  const refreshPlan = useCallback(async () => {
    try {
      const isHome = viewedCycleId === init.homeCycleId;
      const r = await fetch(isHome ? '/api/plan' : `/api/plan?cycleId=${encodeURIComponent(viewedCycleId)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { posts: PlanPost[]; crossMonthPosts?: PlanPost[]; beats?: PlanBeat[]; intake?: PlanIntake; durable?: DurableItemView[] };
      setPosts(d.posts);
      setCrossMonthPosts(d.crossMonthPosts ?? []);
      setBeats(d.beats ?? []);
      if (d.intake) setIntake(d.intake);
      if (d.durable) setDurable(d.durable);
    } catch { /* non-fatal */ }
  }, [viewedCycleId, init.homeCycleId]);

  useEffect(() => { void refreshProposals(); void refreshNotes(); }, [refreshProposals, refreshNotes]);

  // Weather: fetch the forecast in parallel, after mount. A failure, a 401, or an
  // empty forecast (no lat/lon) simply leaves the map empty — the calendar renders
  // identically and nothing is surfaced. Never awaited by plan render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/plan/weather');
        if (!r.ok) return;
        const d = (await r.json()) as { forecast?: WeatherWireDay[]; fetchedAt?: string; cached?: boolean };
        // Surface the forecast fetch time so staleness is diagnosable (the overlay can be
        // up to the package's 6h cache TTL old). Pure decoration — never blocks render.
        if (d.fetchedAt) console.debug(`[weather] forecast fetched ${d.fetchedAt}${d.cached ? ' (from cache)' : ''}`);
        if (!cancelled && Array.isArray(d.forecast) && d.forecast.length) setWeather(indexForecast(d.forecast));
      } catch { /* pure decoration — ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Apply an `applied` result to local state WITHOUT a full refetch: splice the fresh
   *  version of each changed post (from the response's post set) into whichever local array
   *  holds it, matched by id. For a text edit (caption/hook/script) that touches only its own
   *  post and never the plan's shape, this keeps the open editor's `post` prop in sync with
   *  the client's own caret instead of replacing the whole array (which would fight it).
   *  Returns false — caller falls back to refreshPlan — if any changed post is missing from
   *  the response, so a cross-cycle surprise still reconciles the entire view. */
  const applyResultLocally = useCallback((r: ShapeResult): boolean => {
    if (r.mode !== 'applied') return false;
    const fresh = new Map(r.posts.map((p) => [p.id, p] as const));
    if (r.changedPostIds.some((id) => !fresh.has(id))) return false;
    const changed = new Set(r.changedPostIds);
    const splice = (cur: PlanPost[]) =>
      cur.some((p) => changed.has(p.id)) ? cur.map((p) => (changed.has(p.id) ? (fresh.get(p.id) ?? p) : p)) : cur;
    setPosts(splice);
    setCrossMonthPosts(splice);
    return true;
  }, []);

  /** Structural write → refresh the current view (both sets). We re-fetch rather than
   *  trust the response's post set because a cross-cycle edit (a post shown from ANOTHER
   *  cycle in this month's grid) returns THAT cycle's posts, not the viewed cycle's.
   *  `localApply` opts a text edit out of that refetch: the result is spliced in place
   *  (applyResultLocally) so the editor keeps the caret, and the per-save toast is dropped
   *  in favour of the field's own inline "Saving… / Saved" hint. Structural writes keep
   *  the toast + refresh. A localApply that can't splice (missing post) falls back too. */
  const call = useCallback(async (url: string, method: string, payload?: unknown, localApply = false): Promise<void> => {
    if (readOnly) return;
    setBusy(true);
    try {
      const init2: RequestInit = { method };
      if (payload !== undefined) { init2.headers = { 'content-type': 'application/json' }; init2.body = JSON.stringify(payload); }
      const res = await fetch(url, init2);
      if (!res.ok) { flash('Something went wrong. Please try again.'); return; }
      const r = (await res.json()) as ShapeResult;
      if (r.mode === 'applied') {
        if (localApply && applyResultLocally(r)) return;
        flash(r.summary); await refreshPlan();
      }
    } catch { flash('Network error. Please try again.'); }
    finally { setBusy(false); }
  }, [readOnly, flash, refreshPlan, applyResultLocally]);

  /** Move a post's date OPTIMISTICALLY: the card moves in local state immediately, the write +
   *  reconcile run in the background, and on failure (gate/network) the card snaps back with the
   *  usual toast. A card is blocked from a second move while its first is still in flight (pending
   *  state), so rapid successive drags can never double-apply or lose a move; the reconcile refetch
   *  runs only once ALL moves have settled, so a concurrent move on another card isn't clobbered.
   *  Cross-month moves need no special-casing: the grid buckets by date, so a card whose new date
   *  leaves the viewed month simply drops out of the grid, and the settle-refetch surfaces it per
   *  the date-authoritative rules (its own cycle / the "outside this month" strip). */
  const applyLocalDate = useCallback((id: string, date: string) => {
    setPosts((cur) => cur.map((p) => (p.id === id ? { ...p, date } : p)));
    setCrossMonthPosts((cur) => cur.map((p) => (p.id === id ? { ...p, date } : p)));
  }, []);
  const reschedule = useCallback((id: string, dateIso: string) => {
    const guard = planMoveGuard(id, dateIso, [...posts, ...crossMonthPosts], pendingRef.current, readOnly);
    if (!guard) return;                                                       // read-only / pending / no-op
    const { prevDate } = guard;
    applyLocalDate(id, dateIso);                                              // optimistic: move now
    setPending((s) => s.add(id));
    void (async () => {
      let ok = false;
      try {
        const res = await fetch(`/api/posts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: dateIso }) });
        ok = res.ok;
        if (!ok) flash('Couldn’t move that. Please try again.');
      } catch { flash('Network error. Please try again.'); }
      if (!ok) applyLocalDate(id, prevDate);                                  // snap back
      setPending((s) => s.delete(id));
      if (shouldReconcile(ok, pendingRef.current)) await refreshPlan();       // reconcile once all settle
    })();
  }, [readOnly, posts, crossMonthPosts, applyLocalDate, setPending, flash, refreshPlan]);
  // Text saves apply the result in place (no refetch) so the open editor keeps its caret.
  const saveCaption = useCallback((id: string, caption: string) => call(`/api/posts/${id}`, 'PATCH', { caption }, true), [call]);
  const saveHook = useCallback((id: string, hook: string) => call(`/api/posts/${id}`, 'PATCH', { hook }, true), [call]);
  const saveScript = useCallback((id: string, script: string) => call(`/api/posts/${id}`, 'PATCH', { script }, true), [call]);
  const changeFormat = useCallback((id: string, format: string) => call(`/api/posts/${id}`, 'PATCH', { format }), [call]);

  const clearHookCandidates = useCallback((id: string) => {
    setHookCandidates((m) => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n; });
  }, []);

  /** Generate 3 hook candidates for a reel/carousel post (async job → poll → candidates,
   *  not written to the post yet — picking one autosaves it via saveHook (PATCH {hook} →
   *  hook_saved ledger). Generate stays available to re-roll (label → "Regenerate hooks"). */
  const generateHooks = useCallback(async (id: string) => {
    if (readOnly || hookGenerating.has(id)) return;
    setHookError((m) => { const n = new Map(m); n.delete(id); return n; });
    setHookGenerating((s) => new Set(s).add(id));
    try {
      const res = await fetch('/api/plan/hooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetPostId: id }) });
      if (!res.ok) { setHookError((m) => new Map(m).set(id, 'Couldn’t start hook generation.')); return; }
      const r = (await res.json()) as { mode?: string; jobId?: string; summary?: string };
      if (r.mode === 'noop') { flash(r.summary ?? 'Already generating hooks.'); return; }
      if (r.mode === 'pending' && r.jobId) {
        for (let i = 0; i < 30; i++) {
          await new Promise((done) => setTimeout(done, 1200));
          let j: { status: string; candidates?: string[] };
          try { const p = await fetch(`/api/jobs/${r.jobId}`); if (!p.ok) continue; j = (await p.json()) as typeof j; } catch { continue; }
          if (j.status === 'done')  { setHookCandidates((m) => new Map(m).set(id, j.candidates ?? [])); return; }
          if (j.status === 'error') { setHookError((m) => new Map(m).set(id, 'Couldn’t generate hooks. Try again.')); return; }
          if (j.status === 'gone')  { setHookError((m) => new Map(m).set(id, 'Hook generation was lost. Try again.')); return; }
        }
        setHookError((m) => new Map(m).set(id, 'That’s taking longer than expected.'));
      }
    } catch { setHookError((m) => new Map(m).set(id, 'Network error. Please try again.')); }
    finally { setHookGenerating((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [readOnly, hookGenerating, flash]);
  const revert = useCallback((id: string) => call(`/api/posts/${id}/revert`, 'POST'), [call]);
  const removePost = useCallback((id: string) => call(`/api/posts/${id}`, 'DELETE'), [call]);
  const addPost = useCallback((dateIso: string) => call('/api/posts', 'POST', { date: dateIso, cycleId: viewedCycleId }), [call, viewedCycleId]);

  /** Merge a fresh steps array for one post into local state (steps endpoints return
   *  { steps } for that post). */
  const setPostSteps = useCallback((postId: string, steps: PostStepView[]) => {
    setPosts((cur) => cur.map((p) => (p.id === postId ? { ...p, steps } : p)));
  }, []);

  /** Replace a post's checklist with its current format's template (after a format change). */
  const regenerateChecklist = useCallback(async (id: string) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/checklist/regenerate`, { method: 'POST' });
      if (!res.ok) return;
      setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
    } catch { /* non-fatal */ }
  }, [readOnly, setPostSteps]);

  const generateChecklist = useCallback(async (id: string) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/checklist/generate`, { method: 'POST' });
      if (res.status === 409) { flash('This post already has a checklist.'); return; }
      if (res.status === 422) { flash('No checklist for this format.'); return; }
      if (!res.ok) { flash('Could not build the checklist.'); return; }
      setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
      flash('Checklist added.');
    } catch { flash('Network error. Please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  const addStep = useCallback(async (id: string, input: { label: string; leadDays: number }) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (res.ok) setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
    } catch { flash('Network error. Please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  const toggleStep = useCallback(async (id: string, stepId: string, done: boolean) => {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/posts/${id}/steps/${stepId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }) });
      if (res.ok) { setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps); if (done) track('checklist_step_completed', { postId: id, stepId }); }
    } catch { flash('Network error. Please try again.'); }
  }, [readOnly, flash, setPostSteps, track]);

  /** Rename a checklist step's label (autosave on blur/idle → step_renamed ledger). */
  const renameStep = useCallback(async (id: string, stepId: string, label: string) => {
    if (readOnly || !label.trim()) return;
    try {
      const res = await fetch(`/api/posts/${id}/steps/${stepId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) });
      if (res.ok) setPostSteps(id, ((await res.json()) as { steps: PostStepView[] }).steps);
    } catch { flash('Network error. Please try again.'); }
  }, [readOnly, flash, setPostSteps]);

  /** Poll a shape job until it settles; returns the terminal status. */
  const pollJob = useCallback(async (jobId: string): Promise<'done' | 'error' | 'gone' | 'timeout'> => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1600));
      let j: { status: string; posts?: PlanPost[]; summary?: string };
      try { const res = await fetch(`/api/jobs/${jobId}`); if (!res.ok) continue; j = (await res.json()) as typeof j; } catch { continue; }
      if (j.status === 'done') { flash(j.summary ?? 'Updated the caption.'); await refreshPlan(); return 'done'; }
      if (j.status === 'error') { return 'error'; }
      if (j.status === 'gone') { await refreshPlan(); return 'gone'; }
    }
    return 'timeout';
  }, [flash, refreshPlan]);

  const clearShapeError = useCallback((id: string) => {
    setShapeErrors((m) => { if (!m.has(id)) return m; const n = new Map(m); n.delete(id); return n; });
  }, []);

  /** "Shape this post": async via the shape job (deviation 3). `target` selects the field
   *  (caption default; hook/script refine, §26). Marks the post pending rather than mutating
   *  the field; a job failure resolves to a per-post error note with retry. */
  const shape = useCallback(async (id: string, instruction: string, target: ShapeTarget = 'caption') => {
    if (readOnly || !instruction.trim() || shapingIds.has(id)) return;
    lastShapeInstruction.current.set(id, { instruction, target });
    clearShapeError(id);
    track('shape_requested', { postId: id, target });
    setShapingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/posts/${id}/shape`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction, target }) });
      if (!res.ok) { setShapeErrors((m) => new Map(m).set(id, 'Couldn’t start that change.')); return; }
      const r = (await res.json()) as { mode?: string; summary?: string; jobId?: string };
      if (r.mode === 'blocked') { flash(r.summary ?? 'You’ve reached this month’s AI-change limit.'); return; }
      if (r.mode === 'noop') { flash(r.summary ?? 'Still finishing the last change to this post.'); return; }
      if (r.mode === 'empty') { flash(r.summary ?? `There’s no ${target} on this post yet.`); return; }
      if (r.mode === 'pending' && r.jobId) {
        flash(r.summary ?? 'Sprigly is rewriting this…');
        const status = await pollJob(r.jobId);
        if (status === 'error' || status === 'timeout') {
          setShapeErrors((m) => new Map(m).set(id, status === 'timeout' ? 'That’s taking longer than expected.' : 'Couldn’t make that change. Left it as it was.'));
        }
      }
    } catch { setShapeErrors((m) => new Map(m).set(id, 'Network error. Please try again.')); }
    finally { setShapingIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [readOnly, shapingIds, flash, pollJob, clearShapeError, track]);

  /** Retry the last shape/refine instruction for a post (same target). */
  const retryShape = useCallback((id: string) => {
    const last = lastShapeInstruction.current.get(id);
    if (last) void shape(id, last.instruction, last.target);
  }, [shape]);

  /** Generate a reel script (async job writes the script onto the post; pollJob reloads). */
  const generateScript = useCallback(async (id: string, lengthSeconds: number) => {
    if (readOnly || scriptGenerating.has(id)) return;
    setScriptError((m) => { const n = new Map(m); n.delete(id); return n; });
    setScriptGenerating((s) => new Set(s).add(id));
    try {
      const res = await fetch('/api/plan/script', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetPostId: id, lengthSeconds }) });
      if (!res.ok) {
        setScriptError((m) => new Map(m).set(id, res.status === 422 ? 'Add a hook and caption first.' : 'Couldn’t start the script.'));
        return;
      }
      const r = (await res.json()) as { mode?: string; jobId?: string; summary?: string };
      if (r.mode === 'noop') { flash(r.summary ?? 'Already writing a script.'); return; }
      if (r.mode === 'pending' && r.jobId) {
        const status = await pollJob(r.jobId);
        if (status === 'error' || status === 'timeout') {
          setScriptError((m) => new Map(m).set(id, status === 'timeout' ? 'That’s taking longer than expected.' : 'Couldn’t write the script. Try again.'));
        }
      }
    } catch { setScriptError((m) => new Map(m).set(id, 'Network error. Please try again.')); }
    finally { setScriptGenerating((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [readOnly, scriptGenerating, flash, pollJob]);

  /** Talk to your plan → real agent extraction; proposals land in Approvals. */
  const ask = useCallback(async (instruction: string, selectedPostId: string | null): Promise<AgentReply | null> => {
    if (readOnly || !instruction.trim() || agentBusy) return null;
    setAgentBusy(true);
    setAgentError(null);
    // Ceiling so the "Sprigly is thinking…" state never strands on a hung request —
    // aborts to an inline error after a generous window (real Bedrock turns are seconds).
    const controller = new AbortController();
    const ceiling = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch('/api/plan/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction, selectedPostId, conversationId: conversationId.current }),
        signal: controller.signal,
      });
      if (res.status === 429) { setAgentError('You’re sending changes too quickly. Give it a few seconds and try again.'); return null; }
      if (!res.ok) { setAgentError('Something went wrong. Your message is still here, try again.'); return null; }
      const r = (await res.json()) as AgentTurn;
      conversationId.current = r.conversationId;
      const created = r.proposals ?? [];
      const reply: AgentReply = { message: r.message, proposals: created };
      setAgentReply(reply);
      if (created.length) {
        setProposals((cur) => [...created.filter((p) => !cur.some((c) => c.id === p.id)), ...cur]);
        setFlashView('approvals'); setTimeout(() => setFlashView(null), 2800);
      } else if (r.message) { flash(r.message); }
      track('agent_ask_submitted', { proposals: created.length });
      void refreshNotes();
      return reply;
    } catch {
      setAgentError(controller.signal.aborted
        ? 'That’s taking longer than expected. Your message is still here, try again.'
        : 'Network error. Your message is still here, try again.');
      return null;
    } finally { clearTimeout(ceiling); setAgentBusy(false); }
  }, [readOnly, agentBusy, flash, refreshNotes, track]);

  /** Poll an agent-enqueued hook job and surface its candidates in the target post's hook
   *  UI — exactly as a manual "Generate hooks" does (the editor reads hookCandidates). */
  const pollHookInto = useCallback(async (postId: string, jobId: string): Promise<void> => {
    for (let i = 0; i < 30; i++) {
      let j: { status: string; candidates?: string[] };
      try { const p = await fetch(`/api/jobs/${jobId}`); if (!p.ok) { await new Promise((r) => setTimeout(r, 1200)); continue; } j = (await p.json()) as typeof j; }
      catch { await new Promise((r) => setTimeout(r, 1200)); continue; }
      if (j.status === 'done') { setHookCandidates((m) => new Map(m).set(postId, j.candidates ?? [])); return; }
      if (j.status === 'error' || j.status === 'gone') return;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }, []);

  /** Approve/reject a proposal. Returns whether it was APPLIED — a `blocked` approve (an
   *  ordering dependency not yet met) is NOT consumed, so the caller keeps the row
   *  actionable. */
  const decide = useCallback(async (id: string, action: 'approve' | 'reject'): Promise<boolean> => {
    if (proposalBusy) return false;
    setProposalBusy(id);
    try {
      const res = await fetch(`/api/plan/proposals/${id}/${action}`, { method: 'POST' });
      if (!res.ok) { flash('Could not update that. Please try again.'); return false; }
      const d = (await res.json()) as { jobId?: string; hookPostId?: string; blocked?: boolean; message?: string };
      // Blocked = a dependency wasn't met (e.g. approve hooks before the create step). The
      // proposal is untouched — leave the row so it can be approved after its prerequisite.
      if (d.blocked) { flash(d.message ?? 'Approve the earlier step first, then this one.'); return false; }
      setProposals((cur) => cur.filter((p) => p.id !== id));
      track(action === 'approve' ? 'proposal_approved' : 'proposal_discarded', { id });
      if (action === 'approve') {
        flash('Change approved.');
        await refreshPlan();
        if (d.hookPostId && d.jobId) { void pollHookInto(d.hookPostId, d.jobId); }   // hooks surface in the post's hook UI
        else if (d.jobId) { await pollJob(d.jobId); await refreshPlan(); }
      } else { flash('Dismissed.'); }
      return true;
    } catch { flash('Network error. Please try again.'); return false; }
    finally { setProposalBusy(null); }
  }, [proposalBusy, flash, refreshPlan, pollJob, pollHookInto, track]);

  /** Switch the rendered cycle. Every one of the client's months is now editable — the
   *  per-post `canEdit(date)` gate decides each affordance, so no whole-cycle read-only. */
  const switchCycle = useCallback(async (cycleId: string) => {
    setSwitching(true);
    try {
      const isHome = cycleId === init.homeCycleId;
      const res = await fetch(isHome ? '/api/plan' : `/api/plan?cycleId=${encodeURIComponent(cycleId)}`);
      if (!res.ok) { flash('Could not open that month.'); return; }
      const d = (await res.json()) as { posts: PlanPost[]; crossMonthPosts?: PlanPost[]; beats?: PlanBeat[]; intake?: PlanIntake; durable?: DurableItemView[] };
      setPosts(d.posts); setCrossMonthPosts(d.crossMonthPosts ?? []); setBeats(d.beats ?? []); setViewedCycleId(cycleId);
      if (d.intake) setIntake(d.intake); if (d.durable) setDurable(d.durable);
    } catch { flash('Network error. Please try again.'); }
    finally { setSwitching(false); }
  }, [init.homeCycleId, flash]);

  // Whether the viewed cycle is pre-cutoff (intake merges into the brief) vs post-cutoff
  // (intake routes to proposals). Unknown cycle defaults to pre-cutoff (safe: merges, doesn't
  // silently create proposals). Drives the intake surface's copy.
  const viewedCyclePrePlanning = useMemo(
    () => cycles.find((c) => c.cycleId === viewedCycleId)?.prePlanning ?? true,
    [cycles, viewedCycleId],
  );
  const openIntake  = useCallback(() => setIntakeOpen(true), []);
  const closeIntake = useCallback(() => setIntakeOpen(false), []);
  /** Submit the intake to POST /api/plan/intake for the VIEWED cycle. The route classifies
   *  pre/post-cutoff; we refresh the affected surface and RETURN the outcome (incl. the extracted
   *  summary) so the capture surface can show the "here's what we took" feedback moment. The
   *  question list rides along so the route can distribute the freeform brief into answer slots.
   *  Does NOT close the surface — the caller decides (freeform → feedback; guided → feedback). */
  const submitIntake = useCallback(async (payload: {
    answers: Record<string, string>;
    freeNotes: string;
    durableItems: { type: 'idea' | 'next_cycle'; text: string }[];
    source?: 'web' | 'voice';
    sessionId?: string;
  }): Promise<IntakeResult> => {
    if (intakeBusy) return { ok: false };
    setIntakeBusy(true);
    try {
      const res = await fetch('/api/plan/intake', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycleId: viewedCycleId, source: 'web', questions: init.questions, ...payload }),
      });
      if (!res.ok) { flash('Couldn’t save that just now. Please try again.'); return { ok: false }; }
      const d = (await res.json()) as { mode?: string; extracted?: ExtractedSummary; beatsReady?: boolean };
      if (d.mode === 'proposed') { flash('This month has generated — added to your plan for approval.'); void refreshProposals(); }
      else if (d.mode === 'brief_updated') { await refreshPlan(); }
      else { flash('Thanks — noted for the future.'); }
      return { ok: true, mode: d.mode, extracted: d.extracted, beatsReady: d.beatsReady };
    } catch { flash('Network error. Please try again.'); return { ok: false }; }
    finally { setIntakeBusy(false); }
  }, [intakeBusy, viewedCycleId, init.questions, flash, refreshProposals, refreshPlan]);

  return {
    // data
    posts, crossMonthPosts, calendarPosts, beats, beatsOn, cycles, proposals, notes, today: init.today, clientName: init.clientName, pendingMoves,
    questions: init.questions, intake, durable, intakeOpen, intakeBusy, viewedCyclePrePlanning, openIntake, closeIntake, submitIntake,
    homeCycleId: init.homeCycleId, viewedCycleId, readOnly, canEdit, todayCycleId,
    // status
    busy, switching, shapingIds, proposalBusy, agentBusy, agentReply, agentError,
    shapeErrors, loadError, flashView, toast,
    hookGenerating, hookCandidates, hookError,
    scriptGenerating, scriptError, weather,
    // actions
    reschedule, saveCaption, revert, removePost, addPost,
    generateChecklist, addStep, toggleStep, renameStep, shape, retryShape, ask, decide, switchCycle,
    refreshProposals, refreshNotes, setAgentReply, setAgentError, flash, track,
    saveHook, generateHooks, clearHookCandidates,
    saveScript, generateScript,
    changeFormat, regenerateChecklist,
  };
}

export type PlanData = ReturnType<typeof usePlanData>;
