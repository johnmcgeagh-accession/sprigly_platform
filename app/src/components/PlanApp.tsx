'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Images, Image as ImageIcon, Mail, CalendarDays, List, Sparkles, Plus, Undo2, Trash2, CornerDownLeft, Send, ChevronDown, Check, Eye, ArrowLeft } from 'lucide-react';
import type { PlanPost, PostFormat, PostStatus, ShapeResult, UsageSnapshot, CycleSummary } from '@/lib/types';
import type { ProposalView } from '@/lib/agent/types';
import type { NoteView } from '@/lib/agent/notes';
import { isOnTheWay, ON_THE_WAY_LABEL, ON_THE_WAY_TEASER, ON_THE_WAY_BODY, ON_THE_WAY_ARIA } from '@/lib/generation-state';

/** The /api/plan/agent turn response. Mutations arrive as proposals to review —
 *  nothing is applied on the turn itself. */
interface AgentTurn {
  conversationId: string;
  message: string;
  proposals?: ProposalView[];
  changeSetId?: string | null;
}

/* ------------------------------------------------------------------ *
 * Sprigly — client plan surface (app.sprigly.co.uk). Phase 2: a real
 * shaping surface. Structural edits (move / reorder / add / delete /
 * revert / caption) are live via /api/posts*; instructed regen ("make
 * it softer") and voice stay stubbed (Phase 3/5). Ported from
 * sprigly-client-app.jsx.
 * ------------------------------------------------------------------ */

const C = {
  bg: '#F8F9FB', surface: '#FFFFFF', card: '#FFFFFF', navy: '#1E2A4A', muted: '#5B647A',
  faint: '#98A0AE', line: '#E8EAEE', nodeLine: '#CDD2DC', coral: '#FF6F62', coralDeep: '#E2574B',
  coralLt: '#FFEDEB', slate: '#64748B', slateLt: '#EEF1F5', navyLt: '#EDEFF4', tagBg: '#F1F3F6',
  agentBar: '#374254',
};
const softShadow = '0 1px 3px rgba(30,42,74,.07), 0 1px 2px rgba(30,42,74,.04)';
const display = "'DM Serif Display', Georgia, serif";
const body = "'Plus Jakarta Sans', system-ui, sans-serif";

const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WK_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FORMAT_META: Record<PostFormat, { Icon: typeof Film; label: string }> = {
  reel: { Icon: Film, label: 'Reel' },
  carousel: { Icon: Images, label: 'Carousel' },
  single: { Icon: ImageIcon, label: 'Single image' },
  email: { Icon: Mail, label: 'Email' },
};
const FORMAT_CYCLE: PostFormat[] = ['reel', 'carousel', 'single'];

function group(pillar: string) {
  const p = (pillar || '').toLowerCase();
  if (/(product|launch|offer)/.test(p)) return { fg: C.coral, bg: C.coralLt };
  if (/(ethic|educat|sustain|origin|made|cotton)/.test(p)) return { fg: C.slate, bg: C.slateLt };
  if (/(sunday|weekend|style|styling)/.test(p)) return { fg: C.navy, bg: C.navyLt };
  if (/(personal|founder|relationship|need|story)/.test(p)) return { fg: C.coralDeep, bg: C.coralLt };
  return { fg: C.slate, bg: C.slateLt };
}
const shortPillar = (pillar: string) => (pillar || 'Post').split(/\s+/)[0];

/** 'YYYY-MM-DD' → local Date (avoid UTC day-shift). */
function parseISO(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, day || 1);
}
const iso = (y: number, mZero: number, day: number) => `${y}-${String(mZero + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

interface VPost {
  id: string; date: Date; format: PostFormat; pillar: string;
  caption: string; status: PostStatus; script: string | null;
  pendingInstruction: string | null; generationError: string | null;
}

export default function PlanApp({ clientName, posts: initial, cycles, homeCycleId, initialCycleId, initialReadOnly }: {
  clientName: string; posts: PlanPost[]; cycles: CycleSummary[]; homeCycleId: string;
  initialCycleId?: string; initialReadOnly?: boolean;
}) {
  const [posts, setPosts] = useState<PlanPost[]>(initial);
  const [selId, setSelId] = useState<string | null>(initial[0]?.id ?? null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [agentText, setAgentText] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  // Proposal-based agent (commit 3): the conversation id echoed back each turn, the
  // client's pending proposals (review queue), the last assistant reply shown
  // in-thread, and the id currently being approved/rejected.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingProposals, setPendingProposals] = useState<ProposalView[]>([]);
  const [lastReply, setLastReply] = useState<{ message: string; proposals: ProposalView[] } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [proposalBusy, setProposalBusy] = useState<string | null>(null);
  // Active plan notes (review-later captures) + the notes drawer.
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteBusy, setNoteBusy] = useState<string | null>(null);
  // Month switcher (slice 1): which cycle is on screen, whether it's view-only, and
  // the header menu's open state. Writes only ever target the home cycle server-side.
  const [activeCycleId, setActiveCycleId] = useState(initialCycleId ?? homeCycleId);
  const [readOnly, setReadOnly] = useState(initialReadOnly ?? false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const homeMonth = useMemo(() => cycles.find((c) => c.isHome)?.monthLabel ?? 'your current plan', [cycles]);
  const activeMonth = useMemo(
    () => cycles.find((c) => c.cycleId === activeCycleId)?.monthLabel,
    [cycles, activeCycleId],
  );

  /** Switch the rendered cycle via GET /api/plan?cycleId=. Pure read; the home
   *  cycle comes back editable, every other month read-only. */
  async function switchCycle(cycleId: string) {
    if (cycleId === activeCycleId || switching) { setMenuOpen(false); return; }
    setSwitching(true); setMenuOpen(false);
    try {
      const isHome = cycleId === homeCycleId;
      const url = isHome ? '/api/plan' : `/api/plan?cycleId=${encodeURIComponent(cycleId)}`;
      const res = await fetch(url);
      if (!res.ok) { flash('Could not open that month — please try again.'); return; }
      const d = (await res.json()) as { posts: PlanPost[]; readOnly: boolean };
      setPosts(d.posts);
      setReadOnly(d.readOnly);
      setActiveCycleId(cycleId);
      setSelId(d.posts[0]?.id ?? null);
      setSheetOpen(false);
    } catch { flash('Network error — please try again.'); }
    finally { setSwitching(false); }
  }

  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 900);
    f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f);
  }, []);

  // Load the AI-change usage counter, pending proposals, and active notes on mount.
  useEffect(() => { void refreshUsage(); void refreshProposals(); void refreshNotes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function refreshUsage() {
    try { const r = await fetch('/api/usage'); if (r.ok) setUsage((await r.json()) as UsageSnapshot); } catch { /* non-fatal */ }
  }

  async function refreshProposals() {
    try { const r = await fetch('/api/plan/proposals?status=pending'); if (r.ok) setPendingProposals(((await r.json()) as { proposals: ProposalView[] }).proposals); } catch { /* non-fatal */ }
  }

  async function refreshNotes() {
    try { const r = await fetch('/api/plan/notes'); if (r.ok) setNotes(((await r.json()) as { notes: NoteView[] }).notes); } catch { /* non-fatal */ }
  }

  async function dismissNote(id: string) {
    if (noteBusy) return;
    setNoteBusy(id);
    try {
      const r = await fetch(`/api/plan/notes/${id}/dismiss`, { method: 'POST' });
      if (!r.ok) { flash('Could not dismiss that note — please try again.'); return; }
      setNotes((cur) => cur.filter((n) => n.id !== id));
    } catch { flash('Network error — please try again.'); }
    finally { setNoteBusy(null); }
  }

  /** Reload the home plan after an agent action applied a structural change. */
  async function reloadPlan() {
    try {
      const r = await fetch('/api/plan');
      if (!r.ok) return;
      const d = (await r.json()) as { posts: PlanPost[] };
      setPosts(d.posts);
      setSelId((cur) => (d.posts.some((p) => p.id === cur) ? cur : d.posts[0]?.id ?? null));
    } catch { /* non-fatal */ }
  }

  /** Approve or reject a proposal; drop it from the review queue and reflect the
   *  new status in the in-thread reply. */
  async function decideProposal(id: string, action: 'approve' | 'reject') {
    if (proposalBusy) return;
    setProposalBusy(id);
    try {
      const res = await fetch(`/api/plan/proposals/${id}/${action}`, { method: 'POST' });
      if (!res.ok) { flash('Could not update that — please try again.'); return; }
      const d = (await res.json()) as { proposal: ProposalView; jobId?: string };
      setPendingProposals((cur) => cur.filter((p) => p.id !== id));
      setLastReply((lr) => (lr ? { ...lr, proposals: lr.proposals.map((p) => (p.id === id ? d.proposal : p)) } : lr));
      if (action === 'approve') {
        flash('Change approved.');
        // move/delete/add applied synchronously; a rewrite or an add-with-instruction
        // enqueued a caption job — poll it, then reload to show the result (or its
        // failed state). reloadPlan first so a new post shows its 'writing…' state.
        await reloadPlan();
        if (d.jobId) { await pollOne(d.jobId); await reloadPlan(); await refreshUsage(); }
      } else {
        flash('Dismissed.');
      }
    } catch { flash('Network error — please try again.'); }
    finally { setProposalBusy(null); }
  }

  async function approveAllProposals() {
    for (const id of pendingProposals.map((p) => p.id)) {
      // eslint-disable-next-line no-await-in-loop
      await decideProposal(id, 'approve');
    }
    setDrawerOpen(false);
  }

  const flash = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  /** Call a structural endpoint; on success swap in the returned post set.
   *  No-op in a view-only month — the affordances are removed from the UI, and the
   *  server rejects any write outside the home cycle anyway; this is belt-and-braces. */
  async function call(url: string, method: string, payload?: unknown): Promise<void> {
    if (readOnly) return;
    setBusy(true);
    try {
      const init: RequestInit = { method };
      if (payload !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(url, init);
      if (!res.ok) { flash('Something went wrong — please try again.'); return; }
      const r = (await res.json()) as ShapeResult;
      if (r.mode === 'applied') {
        setPosts(r.posts);
        if (r.changedPostIds[0]) setSelId((cur) => (r.posts.some((p) => p.id === cur) ? cur : r.changedPostIds[0]!));
        flash(r.summary);
      }
    } catch {
      flash('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  const vposts = useMemo<VPost[]>(
    () => [...posts]
      .map((p) => ({ id: p.id, date: parseISO(p.date), format: p.format, pillar: p.pillar, caption: p.caption, status: p.status, script: p.script ?? null, pendingInstruction: p.pendingInstruction ?? null, generationError: p.generationError ?? null }))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [posts],
  );

  const anchor = vposts[0]?.date ?? new Date();
  const YEAR = anchor.getFullYear();
  const MONTH = anchor.getMonth();
  const MDAYS = new Date(YEAR, MONTH + 1, 0).getDate();

  const sel = vposts.find((p) => p.id === selId) ?? vposts[0] ?? null;
  const select = (id: string) => { setSelId(id); if (narrow) setSheetOpen(true); };

  // ── actions ────────────────────────────────────────────────────────────────
  const reschedule = (id: string, day: number) => call(`/api/posts/${id}`, 'PATCH', { date: iso(YEAR, MONTH, day) });
  const setFormat   = (id: string, format: PostFormat) => call(`/api/posts/${id}`, 'PATCH', { format });
  const saveCaption = (id: string, caption: string) => call(`/api/posts/${id}`, 'PATCH', { caption });
  const remove      = (id: string) => call(`/api/posts/${id}`, 'DELETE');
  const revert      = (id: string) => call(`/api/posts/${id}/revert`, 'POST');
  const addDraft    = () => {
    const base = sel ? Math.min(MDAYS, sel.date.getDate() + 2) : Math.min(28, 15);
    call('/api/posts', 'POST', { date: iso(YEAR, MONTH, base) });
  };

  // ── Post-level regen (async): enqueue a shape job, poll for the rewritten caption ──
  async function shapePost(id: string, instruction: string) {
    if (readOnly || !instruction.trim() || rewritingId) return;
    try {
      const res = await fetch(`/api/posts/${id}/shape`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }) });
      if (!res.ok) { flash('Could not start that change — please try again.'); return; }
      const r = (await res.json()) as { mode?: string; summary?: string; jobId?: string; usage?: UsageSnapshot };
      if (r.mode === 'blocked') { if (r.usage) setUsage(r.usage); flash(r.summary ?? 'You’ve reached this month’s AI-change limit.'); return; }
      if (r.mode === 'pending' && r.jobId) {
        setRewritingId(id);
        flash(r.summary ?? 'Sprigly is rewriting this…');
        await pollOne(r.jobId);
        setRewritingId(null);
        await refreshUsage();
      }
    } catch { flash('Network error — please try again.'); }
  }

  // The client-facing retry of a generation is GONE (spec G4). Nothing here restarts one:
  // the daily sweep does, twice, and a post it cannot recover becomes an operator item.
  // /api/posts/:id/retry-generation still exists as a route; no client surface calls it.

  /** Poll one shape job until it settles; swap in the fresh posts on done. */
  async function pollOne(jobId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1600));
      let j: { status: string; posts?: PlanPost[]; summary?: string };
      try { const res = await fetch(`/api/jobs/${jobId}`); if (!res.ok) continue; j = (await res.json()) as typeof j; }
      catch { continue; }
      if (j.status === 'done')  { if (j.posts) setPosts(j.posts); flash(j.summary ?? 'Updated the caption.'); return; }
      if (j.status === 'error') { flash(j.summary ?? 'Could not make that change — left the caption as it was.'); return; }
      if (j.status === 'gone')  { try { const p = await fetch('/api/plan'); if (p.ok) { const d = (await p.json()) as { posts?: PlanPost[] }; if (d.posts) setPosts(d.posts); } } catch { /* ignore */ } return; }
      // pending → keep polling
    }
    flash('Still working — give it a moment, then refresh.');
  }

  // ── Plan-level agent: route server-side, then apply / poll / propose / answer ──
  async function runAgent(text: string) {
    const instruction = text.trim();
    if (readOnly || !instruction || agentBusy) return;
    setAgentBusy(true);
    try {
      const res = await fetch('/api/plan/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction, selectedPostId: selId, conversationId }),
      });
      if (!res.ok) { flash('Something went wrong — please try again.'); return; }
      const r = (await res.json()) as AgentTurn;
      setConversationId(r.conversationId);
      const created = r.proposals ?? [];
      setLastReply({ message: r.message, proposals: created });
      setAgentText('');
      if (created.length) {
        // Merge into the review queue (new first, de-duped). Nothing applies until
        // the client approves — the plan is unchanged on this turn.
        setPendingProposals((cur) => [...created.filter((p) => !cur.some((c) => c.id === p.id)), ...cur]);
      } else {
        flash(r.message);
      }
      void refreshNotes();   // a turn may have captured a note
    } catch { flash('Network error — please try again.'); }
    finally { setAgentBusy(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.navy, fontFamily: body }}>
      <header style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: narrow ? '15px 18px' : '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <SprigMark size={narrow ? 22 : 26} />
          <span style={{ fontFamily: display, fontSize: narrow ? 18 : 22, color: C.coral }}>Sprigly</span>
        </span>
        <MonthMenu
          clientName={clientName}
          cycles={cycles}
          activeCycleId={activeCycleId}
          activeMonthLabel={activeMonth ?? MONTHS[MONTH]!}
          postCount={vposts.length}
          readOnly={readOnly}
          switching={switching}
          open={menuOpen}
          onToggle={() => setMenuOpen((o) => !o)}
          onClose={() => setMenuOpen(false)}
          onPick={switchCycle}
          narrow={narrow}
        />
      </header>

      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', maxWidth: 1240, margin: '0 auto', minHeight: 'calc(100vh - 78px)' }}>
        <section style={{ flex: narrow ? 'unset' : '0 0 52%', padding: narrow ? '20px 14px 132px' : '28px 28px 132px', borderRight: narrow ? 'none' : `1px solid ${C.line}` }}>
          {readOnly && <ViewOnlyBanner homeMonth={homeMonth} onBack={() => switchCycle(homeCycleId)} />}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <Kicker>Your plan</Kicker>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!readOnly && <button onClick={addDraft} disabled={busy} style={{ ...ghostBtn, padding: '7px 12px', opacity: busy ? 0.5 : 1 }}><Plus size={14} /> Add a post</button>}
              <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: 3 }}>
                <Toggle active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
                <Toggle active={view === 'list'} onClick={() => setView('list')} icon={List} label="List" />
              </div>
            </div>
          </div>

          {vposts.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: C.faint, fontSize: 14, border: `1.5px dashed ${C.line}`, borderRadius: 14 }}>
              {readOnly
                ? 'This month has no posts to show.'
                : <>No posts yet — use <strong>Add a post</strong> to start, or your plan will appear here once it&rsquo;s generated.</>}
            </div>
          ) : view === 'calendar' ? (
            <CalendarView posts={vposts} selId={sel?.id ?? null} onSelect={select} onReschedule={reschedule} year={YEAR} month={MONTH} mdays={MDAYS} dragId={dragId} setDragId={setDragId} readOnly={readOnly} />
          ) : (
            <ListView posts={vposts} selId={sel?.id ?? null} onSelect={select} />
          )}

          <Legend />
        </section>

        {!narrow && (
          <section style={{ flex: 1, padding: '28px 30px 132px' }}>
            {readOnly
              ? <ReadOnlyDetail post={sel} />
              : <Detail post={sel} busy={busy} rewriting={rewritingId === sel?.id} onSetFormat={setFormat} onSaveCaption={saveCaption} onRemove={remove} onRevert={revert} onShape={shapePost} />}
          </section>
        )}
      </div>

      {narrow && sheetOpen && sel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,42,74,.32)', zIndex: 40 }} onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88vh', overflowY: 'auto', background: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '16px 18px 80px', boxShadow: '0 -16px 44px rgba(30,42,74,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 12px' }}>
              <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line }} />
            </div>
            {readOnly
              ? <ReadOnlyDetail post={sel} />
              : <Detail post={sel} busy={busy} rewriting={rewritingId === sel?.id} onSetFormat={setFormat} onSaveCaption={saveCaption} onRemove={remove} onRevert={revert} onShape={shapePost} />}
          </div>
        </div>
      )}

      {readOnly
        ? <BackBar homeMonth={homeMonth} onBack={() => switchCycle(homeCycleId)} />
        : <AgentBar
            value={agentText} onChange={setAgentText} onRun={runAgent} busy={agentBusy} usage={usage}
            proposals={pendingProposals} lastReply={lastReply} drawerOpen={drawerOpen}
            proposalBusy={proposalBusy}
            onToggleDrawer={() => { setDrawerOpen((o) => !o); setNotesOpen(false); }}
            onApprove={(id) => decideProposal(id, 'approve')}
            onReject={(id) => decideProposal(id, 'reject')}
            onApproveAll={approveAllProposals}
            notes={notes} notesOpen={notesOpen} noteBusy={noteBusy}
            onToggleNotes={() => { setNotesOpen((o) => !o); setDrawerOpen(false); }}
            onDismissNote={dismissNote}
          />}

      {toast && (
        <div className="toast" role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 84, zIndex: 60, background: C.navy, color: '#fff', padding: '11px 16px', borderRadius: 12, fontSize: 13.5, maxWidth: 'min(520px,92vw)', boxShadow: '0 12px 32px rgba(30,42,74,.26)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Sparkles size={15} color={C.coral} /> <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- views ---------------- */

function CalendarView({ posts, selId, onSelect, onReschedule, year, month, mdays, dragId, setDragId, readOnly }: {
  posts: VPost[]; selId: string | null; onSelect: (id: string) => void; onReschedule: (id: string, day: number) => void;
  year: number; month: number; mdays: number; dragId: string | null; setDragId: (id: string | null) => void; readOnly: boolean;
}) {
  const [over, setOver] = useState<number | null>(null);
  const byDay: Record<number, VPost[]> = {};
  posts.forEach((p) => { if (p.date.getMonth() === month) (byDay[p.date.getDate()] = byDay[p.date.getDate()] || []).push(p); });

  const firstDow = new Date(year, month, 1).getDay();
  const lead = (firstDow + 6) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: mdays }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 600 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 7, marginBottom: 9 }}>
          {WK_MON.map((d) => (<div key={d} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.faint, textAlign: 'center' }}>{d}</div>))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 7, marginBottom: 7 }}>
            {week.map((day, di) => {
              const dayPosts = day ? byDay[day] || [] : [];
              const isOver = over === day && dragId != null;
              const weekend = di >= 5;
              return (
                <div key={di}
                  onDragOver={(e) => { if (!readOnly && day && dragId != null) { e.preventDefault(); setOver(day); } }}
                  onDragLeave={() => setOver((o) => (o === day ? null : o))}
                  onDrop={(e) => { if (readOnly) return; e.preventDefault(); if (day && dragId != null) onReschedule(dragId, day); setOver(null); setDragId(null); }}
                  style={{ minHeight: 94, background: day ? (isOver ? C.coralLt : C.card) : 'transparent', border: `1px solid ${isOver ? C.coral : day ? C.line : 'transparent'}`, borderRadius: 10, padding: 6, boxShadow: day ? softShadow : 'none', transition: 'background .12s, border-color .12s' }}>
                  {day && <div style={{ fontSize: 11.5, fontWeight: 700, color: weekend ? C.coral : C.faint, marginBottom: 5, paddingLeft: 2 }}>{day}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dayPosts.map((p) => {
                      const g = group(p.pillar); const Icon = FORMAT_META[p.format].Icon; const isSel = p.id === selId;
                      return (
                        <button key={p.id} draggable={!readOnly} onDragStart={() => { if (!readOnly) setDragId(p.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}
                          onClick={() => onSelect(p.id)} className="chip-cal"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', cursor: readOnly ? 'pointer' : 'grab', background: isSel ? g.fg : g.bg, color: isSel ? '#fff' : g.fg, border: `1px solid ${isSel ? g.fg : 'transparent'}`, borderLeft: `3px solid ${g.fg}`, borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 11, fontWeight: 600, lineHeight: 1.1, opacity: dragId === p.id ? 0.4 : 1 }}>
                          <Icon size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortPillar(p.pillar)}</span>
                          {p.status === 'new' && <span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 800 }}>NEW</span>}
                          {p.status === 'edited' && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: 3, background: isSel ? '#fff' : C.coral }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {!readOnly && <p style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>Drag any post to another day to reschedule it.</p>}
      </div>
    </div>
  );
}

function ListView({ posts, selId, onSelect }: { posts: VPost[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      {posts.map((p, i, a) => (<SprigRow key={p.id} post={p} first={i === 0} last={i === a.length - 1} selected={p.id === selId} onClick={() => onSelect(p.id)} />))}
    </div>
  );
}

function SprigRow({ post, first, last, selected, onClick }: { post: VPost; first: boolean; last: boolean; selected: boolean; onClick: () => void }) {
  const Icon = FORMAT_META[post.format].Icon; const g = group(post.pillar);
  const filled = selected || post.status === 'new';
  const nodeFill = filled ? C.coral : C.card;
  const nodeBorder = filled ? C.coral : post.status === 'edited' ? C.coral : C.nodeLine;
  return (
    <button onClick={onClick} className="sprigRow" style={{ display: 'flex', width: '100%', gap: 14, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
      <div style={{ position: 'relative', width: 34, flex: '0 0 34px' }}>
        <span style={{ position: 'absolute', left: 16, top: first ? 26 : 0, bottom: last ? 'calc(100% - 26px)' : 0, width: 2, background: C.line }} />
        <span style={{ position: 'absolute', left: 16, top: 26, transform: 'translate(-50%,-50%)', width: selected ? 17 : 13, height: selected ? 17 : 13, borderRadius: '50%', background: nodeFill, border: `2px solid ${nodeBorder}`, boxShadow: selected ? `0 0 0 4px ${C.coralLt}` : 'none' }} />
      </div>
      <div className="sprigCard" style={{ flex: 1, marginBottom: 12, padding: '13px 15px', background: selected ? C.card : 'transparent', border: `1px solid ${selected ? C.line : 'transparent'}`, borderRadius: 12, boxShadow: selected ? softShadow : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: display, fontSize: 16, color: C.navy }}>{`${WK[post.date.getDay()]} ${MONTHS[post.date.getMonth()]} ${post.date.getDate()}`}</span>
          <StatusTag status={post.status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: g.fg, fontWeight: 600 }}><Icon size={13} /> {FORMAT_META[post.format].label}</span>
          <span style={{ color: C.line }}>·</span>
          <span style={{ color: C.muted }}>{post.pillar}</span>
        </div>
        {/* G4: 'generating' and 'generation_failed' read the same to a client — the words are
            not here yet, and nothing is being asked of them. The sweep is what makes that true
            (lib/generation-state.ts). The real status stays on the row for the operator. */}
        {isOnTheWay(post.status)
          ? <p style={{ margin: 0, fontSize: 13, color: C.muted }} aria-label={ON_THE_WAY_ARIA}>{ON_THE_WAY_TEASER}</p>
          : <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{post.caption.replace(/\n+/g, ' ')}</p>}
      </div>
    </button>
  );
}

/* ---------------- detail (editable) ---------------- */

function Detail({ post, busy, rewriting, onSetFormat, onSaveCaption, onRemove, onRevert, onShape }: {
  post: VPost | null; busy: boolean; rewriting: boolean;
  onSetFormat: (id: string, f: PostFormat) => void; onSaveCaption: (id: string, c: string) => void;
  onRemove: (id: string) => void; onRevert: (id: string) => void; onShape: (id: string, instruction: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [shapeText, setShapeText] = useState('');
  useEffect(() => { setDraft(post?.caption ?? ''); }, [post?.id, post?.caption]);
  useEffect(() => { setShapeText(''); }, [post?.id]);
  if (!post) return null;
  const fireShape = () => { if (shapeText.trim()) { onShape(post.id, shapeText); setShapeText(''); } };
  const Icon = FORMAT_META[post.format].Icon; const g = group(post.pillar);
  const dirty = draft !== post.caption;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => onSetFormat(post.id, nextFormat(post.format))} disabled={busy} title="Tap to change format"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: g.bg, color: g.fg, padding: '5px 11px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
          <Icon size={14} /> {FORMAT_META[post.format].label}
        </button>
        <span style={{ fontSize: 12.5, color: C.muted }}>{post.pillar}</span>
        <span style={{ color: C.line }}>·</span>
        <span style={{ fontFamily: display, fontSize: 16, color: C.navy }}>{`${WK[post.date.getDay()]} ${MONTHS[post.date.getMonth()]} ${post.date.getDate()}`}</span>
        <StatusTag status={post.status} />
        {post.status !== 'planned' && !isOnTheWay(post.status) && <button onClick={() => onRevert(post.id)} disabled={busy} style={{ marginLeft: 'auto', ...textBtn }}><Undo2 size={13} /> Revert</button>}
      </div>

      {isOnTheWay(post.status) ? (
        /* ONE state, not two. The client is never shown the generation error, and never
           handed the job of restarting it — the sweep does that, and what it cannot recover
           reaches an operator instead (admin → Failed Posts). */
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, color: C.navy, fontSize: 14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: '22px 18px' }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3, flex: '0 0 auto' }}>
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: C.coralDeep, opacity: .3, display: 'block' }} />
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: C.coralDeep, opacity: .6, display: 'block' }} />
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: C.coralDeep, opacity: 1, display: 'block' }} />
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{ON_THE_WAY_LABEL}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>{ON_THE_WAY_BODY}</div>
          </div>
        </div>
      ) : (
      <>
      <Kicker>Caption</Kicker>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={9}
        style={{ width: '100%', marginTop: 9, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px', fontFamily: body, fontSize: 15, lineHeight: 1.62, color: C.navy, boxShadow: softShadow, resize: 'vertical', outline: 'none' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={() => onSaveCaption(post.id, draft)} disabled={busy || !dirty} style={{ ...primaryBtn, padding: '0 16px', height: 38, opacity: busy || !dirty ? 0.45 : 1 }}>
          <CornerDownLeft size={16} /> Save caption
        </button>
        {dirty && <button onClick={() => setDraft(post.caption)} style={textBtn}>Discard</button>}
        <button onClick={() => onRemove(post.id)} disabled={busy} style={{ ...textBtn, marginLeft: 'auto', color: C.coralDeep }}><Trash2 size={14} /> Remove post</button>
      </div>

      <div style={{ marginTop: 18, border: `1.5px dashed ${C.line}`, borderRadius: 14, padding: '16px', textAlign: 'center', color: C.faint, fontSize: 13 }}>
        Video preview — coming soon.
      </div>
      <div style={{ marginTop: 20 }}>
        <Kicker>Shape this post</Kicker>
        {rewriting ? (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 9, color: C.coralDeep, fontSize: 13.5, background: C.coralLt, borderRadius: 11, padding: '11px 14px' }}>
            <span className="spin" style={{ width: 14, height: 14, border: `2px solid #FFD9D4`, borderTopColor: C.coralDeep, borderRadius: '50%', display: 'inline-block' }} />
            Sprigly is rewriting this…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              {/* "more about the fabric" assumed a clothing brand. A candle maker reading that on
                  their own editor is being shown someone else's vocabulary — the same mistake as
                  the composer placeholder, one size down. */}
              <input value={shapeText} onChange={(e) => setShapeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fireShape(); }}
                placeholder="Make it softer · shorter · warmer · more specific…" style={inputStyle} />
              <button onClick={fireShape} disabled={busy || !shapeText.trim()} aria-label="Ask Sprigly to rewrite"
                style={{ ...primaryBtn, padding: '0 14px', height: 42, opacity: busy || !shapeText.trim() ? 0.45 : 1 }}><Sparkles size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
              {['Make it softer', 'Make it shorter', 'Warmer tone'].map((s) => (
                <button key={s} onClick={() => onShape(post.id, s)} style={chip}>{s}</button>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: C.faint, marginTop: 9 }}>Sprigly rewrites it in your voice and checks it before it lands. Revert always returns to the original.</p>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
function nextFormat(f: PostFormat): PostFormat {
  if (f === 'email') return 'email';
  const i = FORMAT_CYCLE.indexOf(f);
  return FORMAT_CYCLE[(i + 1) % FORMAT_CYCLE.length]!;
}

/* ---------------- bottom bar (the plan agent) ---------------- */

const AGENT_CHIPS = ['Move the Tuesday post to Friday', 'Make them all warmer', 'Add a post about the linen launch'];

/** Format an ISO datetime as "12 Aug". */
function fmtDay(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function usageLine(u: UsageSnapshot | null): { text: string; atLimit: boolean } {
  if (!u) return { text: '', atLimit: false };
  if (u.unlimited) return { text: u.overrideUntil ? `Unlimited until ${fmtDay(u.overrideUntil)}` : 'Unlimited', atLimit: false };
  const atLimit = u.used >= u.limit;
  return { text: `${u.used} of ${u.limit} AI changes this month`, atLimit };
}

function AgentBar({ value, onChange, onRun, busy, usage, proposals, lastReply, drawerOpen, proposalBusy, onToggleDrawer, onApprove, onReject, onApproveAll, notes, notesOpen, noteBusy, onToggleNotes, onDismissNote }: {
  value: string; onChange: (v: string) => void; onRun: (text: string) => void; busy: boolean; usage: UsageSnapshot | null;
  proposals: ProposalView[]; lastReply: { message: string; proposals: ProposalView[] } | null;
  drawerOpen: boolean; proposalBusy: string | null;
  onToggleDrawer: () => void; onApprove: (id: string) => void; onReject: (id: string) => void; onApproveAll: () => void;
  notes: NoteView[]; notesOpen: boolean; noteBusy: string | null;
  onToggleNotes: () => void; onDismissNote: (id: string) => void;
}) {
  const { text: counter, atLimit } = usageLine(usage);
  const pendingCount = proposals.length;
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: C.agentBar, borderTop: '1px solid rgba(255,255,255,.07)', padding: '12px 18px', boxShadow: '0 -6px 28px rgba(30,42,74,.20)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Notes drawer (expands upward) */}
        {notesOpen && notes.length > 0 && (
          <div style={{ marginBottom: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 10, maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)', marginBottom: 8 }}>Notes ({notes.length})</div>
            {notes.map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'rgba(255,255,255,.9)' }}>
                  {n.content}
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'rgba(255,255,255,.45)' }}>
                    {n.source === 'voice' ? '🎙 voice · ' : ''}{fmtDay(n.createdAt)}
                    {(n.relevantFrom || n.relevantTo) ? ` · relevant ${n.relevantFrom ?? '…'}–${n.relevantTo ?? '…'}` : ''}
                  </span>
                </span>
                <button onClick={() => onDismissNote(n.id)} disabled={noteBusy != null} style={{ ...darkGhostBtn, height: 26, padding: '0 10px', opacity: noteBusy != null ? 0.5 : 1 }}>Dismiss</button>
              </div>
            ))}
          </div>
        )}

        {/* Proposals review drawer (expands upward) */}
        {drawerOpen && pendingCount > 0 && (
          <div style={{ marginBottom: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 10, maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)' }}>To review ({pendingCount})</span>
              <button onClick={onApproveAll} disabled={proposalBusy != null} style={{ marginLeft: 'auto', ...darkPrimaryBtn, height: 28, padding: '0 12px', opacity: proposalBusy != null ? 0.5 : 1 }}>
                <Check size={13} /> Approve all
              </button>
            </div>
            {proposals.map((p) => (
              <ProposalRow key={p.id} p={p} busy={proposalBusy === p.id} disabled={proposalBusy != null} onApprove={() => onApprove(p.id)} onReject={() => onReject(p.id)} />
            ))}
          </div>
        )}

        {/* Header row: label + review badge + usage counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
          <Sparkles size={15} color={C.coral} />
          <span className="planLabel" style={{ fontFamily: display, fontSize: 14, color: '#fff' }}>Talk to your plan</span>
          {pendingCount > 0 && (
            <button onClick={onToggleDrawer} aria-expanded={drawerOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.coral, color: '#fff', border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: body }}>
              {pendingCount} to review
              <ChevronDown size={13} style={{ transform: drawerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          )}
          {notes.length > 0 && (
            <button onClick={onToggleNotes} aria-expanded={notesOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.10)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: body }}>
              {notes.length} note{notes.length === 1 ? '' : 's'}
              <ChevronDown size={13} style={{ transform: notesOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
          )}
          {counter && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: atLimit ? '#FFC9C2' : 'rgba(255,255,255,.62)' }}>
              {counter}
              {atLimit && <span style={{ color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>· editing stays free</span>}
            </span>
          )}
        </div>

        {/* Last assistant reply, with inline actions on any proposals it created */}
        {!busy && lastReply && (
          <div style={{ marginBottom: 9, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.92)', lineHeight: 1.5 }}>{lastReply.message}</div>
            {lastReply.proposals.map((p) => (
              <div key={p.id} style={{ marginTop: 8 }}>
                {p.status === 'pending'
                  ? <ProposalRow p={p} busy={proposalBusy === p.id} disabled={proposalBusy != null} onApprove={() => onApprove(p.id)} onReject={() => onReject(p.id)} />
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: p.status === 'applied' ? '#9BE7C4' : 'rgba(255,255,255,.5)' }}>
                      <Check size={13} /> {p.status === 'applied' ? 'Approved' : p.status}
                    </span>}
              </div>
            ))}
          </div>
        )}

        {busy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 13.5, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 12, padding: '11px 14px' }}>
            <span className="spin" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
            Sprigly is working…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onRun(value); }}
                placeholder="Move the Tuesday post to Friday · change the reel to a carousel · make them all warmer…"
                aria-label="Talk to your plan"
                style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.08)', color: '#fff', fontFamily: body, fontSize: 14, outline: 'none' }}
              />
              <button
                onClick={() => value.trim() && onRun(value)}
                disabled={!value.trim()}
                aria-label="Send to Sprigly"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, padding: '0 15px', background: C.coral, color: '#fff', border: 'none', borderRadius: 12, cursor: value.trim() ? 'pointer' : 'default', fontFamily: body, fontSize: 14, fontWeight: 600, opacity: value.trim() ? 1 : 0.45 }}
              >
                <Send size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 9 }}>
              {AGENT_CHIPS.map((c) => (
                <button key={c} onClick={() => onRun(c)}
                  style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 999, padding: '5px 12px', fontSize: 12, color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: body }}>
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One proposal in the review drawer / inline reply (dark agent bar). */
function ProposalRow({ p, busy, disabled, onApprove, onReject }: {
  p: ProposalView; busy: boolean; disabled: boolean; onApprove: () => void; onReject: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'rgba(255,255,255,.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.summary}>{p.summary}</span>
      <button onClick={onApprove} disabled={disabled} style={{ ...darkPrimaryBtn, height: 28, padding: '0 11px', opacity: disabled ? 0.5 : 1 }}>
        {busy
          ? <span className="spin" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
          : <Check size={13} />}
        Approve
      </button>
      <button onClick={onReject} disabled={disabled} style={{ ...darkGhostBtn, height: 28, padding: '0 11px', opacity: disabled ? 0.5 : 1 }}>Dismiss</button>
    </div>
  );
}

/* ---------------- month switcher ---------------- */

/** Header title that doubles as the month menu trigger. With one month it reads as
 *  a plain title; with more, a chevron invites the switch. Kept deliberately plain
 *  for slice 1 — the receding-plane stack is a later slice over this same data. */
function MonthMenu({ clientName, cycles, activeCycleId, activeMonthLabel, postCount, readOnly, switching, open, onToggle, onClose, onPick, narrow }: {
  clientName: string; cycles: CycleSummary[]; activeCycleId: string; activeMonthLabel: string;
  postCount: number; readOnly: boolean; switching: boolean; open: boolean;
  onToggle: () => void; onClose: () => void; onPick: (cycleId: string) => void; narrow: boolean;
}) {
  const hasChoice = cycles.length > 1;
  const shortMonth = activeMonthLabel.split(' ')[0];   // 'July 2026' → 'July' for the compact title

  return (
    <div style={{ position: 'relative', textAlign: 'right', lineHeight: 1.25 }}>
      <button
        onClick={hasChoice ? onToggle : undefined}
        aria-haspopup={hasChoice ? 'menu' : undefined}
        aria-expanded={hasChoice ? open : undefined}
        disabled={switching}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0,
          font: 'inherit', color: 'inherit', cursor: hasChoice ? 'pointer' : 'default', textAlign: 'right',
        }}
      >
        <span style={{ fontFamily: display, fontSize: narrow ? 17 : 20, color: C.navy }}>
          {clientName} · <span style={{ fontStyle: 'italic', color: C.coral }}>{shortMonth}</span> plan
        </span>
        {hasChoice && (
          <ChevronDown size={narrow ? 16 : 18} color={C.faint}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
        )}
      </button>
      <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
        {readOnly
          ? <>view only · {postCount} posts</>
          : <>{postCount} posts · opened from your link, no password needed</>}
      </div>

      {open && hasChoice && (
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div role="menu" style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 71, width: 'min(320px, 86vw)',
            background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 16px 44px rgba(30,42,74,.18)',
            padding: 6, textAlign: 'left',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: C.faint, padding: '8px 10px 6px' }}>
              Your months
            </div>
            {cycles.map((c) => (
              <MonthRow key={c.cycleId} cycle={c} active={c.cycleId === activeCycleId} onClick={() => onPick(c.cycleId)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MonthRow({ cycle, active, onClick }: { cycle: CycleSummary; active: boolean; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
      background: active ? C.coralLt : 'transparent', border: 'none', borderRadius: 10, padding: '10px 10px', font: 'inherit',
    }}>
      <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
        {active && <Check size={15} color={C.coralDeep} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: display, fontSize: 16, color: C.navy }}>{cycle.monthLabel}</span>
          {cycle.isHome
            ? <Tag bg={C.coralLt} fg={C.coralDeep}>this month</Tag>
            : <Tag bg={C.tagBg} fg={C.muted}>view only</Tag>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
          <span>{cycle.livePostCount} posts</span>
          {cycle.preservedEditCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.slate }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: C.slate }} />{cycle.preservedEditCount} kept
            </span>
          )}
          {cycle.preservedEditOrphanCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.coralDeep, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: C.coral }} />{cycle.preservedEditOrphanCount} to review
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** In-page banner shown at the top of a view-only month. Restates that edits live in
 *  the current plan and offers the way back. */
function ViewOnlyBanner({ homeMonth, onBack }: { homeMonth: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '11px 14px', background: C.navyLt, border: `1px solid ${C.line}`, borderRadius: 12, flexWrap: 'wrap' }}>
      <Eye size={15} color={C.slate} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: C.muted, flex: 1, minWidth: 160 }}>
        You&rsquo;re looking at a past month. Edits belong to your current plan — <strong style={{ color: C.navy, fontWeight: 600 }}>{homeMonth}</strong>.
      </span>
      <button onClick={onBack} style={{ ...ghostBtn, padding: '6px 11px' }}><ArrowLeft size={13} /> Back to {homeMonth}</button>
    </div>
  );
}

/** Read-only detail for a past month: everything the editable Detail shows, minus
 *  every affordance that writes. */
function ReadOnlyDetail({ post }: { post: VPost | null }) {
  if (!post) return null;
  const Icon = FORMAT_META[post.format].Icon; const g = group(post.pillar);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: g.bg, color: g.fg, padding: '5px 11px', borderRadius: 9, fontSize: 12.5, fontWeight: 600 }}>
          <Icon size={14} /> {FORMAT_META[post.format].label}
        </span>
        <span style={{ fontSize: 12.5, color: C.muted }}>{post.pillar}</span>
        <span style={{ color: C.line }}>·</span>
        <span style={{ fontFamily: display, fontSize: 16, color: C.navy }}>{`${WK[post.date.getDay()]} ${MONTHS[post.date.getMonth()]} ${post.date.getDate()}`}</span>
        <StatusTag status={post.status} />
      </div>

      <Kicker>Caption</Kicker>
      <p style={{ marginTop: 9, background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: '16px 18px', fontFamily: body, fontSize: 15, lineHeight: 1.62, color: C.navy, boxShadow: softShadow, whiteSpace: 'pre-wrap' }}>
        {post.caption || <span style={{ color: C.faint }}>No caption.</span>}
      </p>
      <p style={{ fontSize: 11.5, color: C.faint, marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Eye size={13} /> This month is view only. Switch to your current plan to make changes.
      </p>
    </div>
  );
}

/** Replaces the agent bar in a view-only month — the persistent bottom slot keeps a
 *  job (get home) instead of going dead. */
function BackBar({ homeMonth, onBack }: { homeMonth: string; onBack: () => void }) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: C.agentBar, borderTop: '1px solid rgba(255,255,255,.07)', padding: '14px 18px', boxShadow: '0 -6px 28px rgba(30,42,74,.20)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,.72)', fontSize: 13.5 }}>
          <Eye size={15} color={C.coral} /> Viewing a past month — edits are off here.
        </span>
        <button onClick={onBack} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', background: C.coral, color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: body, fontSize: 14, fontWeight: 600 }}>
          <ArrowLeft size={15} /> Back to {homeMonth}
        </button>
      </div>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

/** The Sprigly sprout mark (studio/svg_logos/sprigly-mark-coral.svg), inlined. */
function SprigMark({ size }: { size: number }) {
  return (
    <svg width={(size * 100) / 110} height={size} viewBox="0 0 100 110" fill={C.coral} aria-label="Sprigly" role="img">
      <path d="M50 10 C 36 12, 24 26, 24 44 C 24 60, 36 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 56 20, 50 10 Z" />
      <path d="M50 10 C 64 12, 76 26, 76 44 C 76 60, 64 74, 50 76 C 50 70, 50 56, 50 46 C 50 32, 44 20, 50 10 Z" opacity="0.78" />
      <line x1="50" y1="76" x2="50" y2="98" stroke={C.coral} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: C.coral }}>{children}</span>;
}
function Toggle({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Film; label: string }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: body, fontSize: 13, fontWeight: 600, background: active ? C.coral : 'transparent', color: active ? '#fff' : C.muted, boxShadow: active ? softShadow : 'none' }}>
      <Icon size={14} /> {label}
    </button>
  );
}
function StatusTag({ status }: { status: PostStatus }) {
  if (status === 'edited') return <Tag bg={C.tagBg} fg={C.muted}>edited</Tag>;
  if (status === 'new') return <Tag bg={C.coralLt} fg={C.coralDeep}>new</Tag>;
  // Both in-flight statuses carry the SAME tag. A client has no use for which of our
  // processes runs next, and 'needs a retry' asked them for something nobody wants from them.
  if (isOnTheWay(status)) return <Tag bg={C.coralLt} fg={C.coralDeep}>on its way</Tag>;
  return null;
}
function Tag({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', background: bg, color: fg, padding: '2px 7px', borderRadius: 6 }}>{children}</span>;
}
function Legend() {
  const items: [string, string][] = [['Product', C.coral], ['Origin & education', C.slate], ['Style & personal', C.navy]];
  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
      {items.map(([l, c]) => (<span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c }} /> {l}</span>))}
    </div>
  );
}

const primaryBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: C.coral, color: '#fff', border: 'none', borderRadius: 11, cursor: 'pointer', fontFamily: body, fontSize: 14, fontWeight: 600 } as const;
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, background: C.card, color: C.coralDeep, border: `1px solid ${C.line}`, borderRadius: 11, cursor: 'pointer', fontFamily: body, fontSize: 13, fontWeight: 600 } as const;
const textBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: body, fontSize: 12.5, fontWeight: 600 } as const;
const inputStyle = { flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 11, border: `1px solid ${C.line}`, background: C.card, color: C.navy, fontFamily: body, fontSize: 14, outline: 'none' } as const;
const chip = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 999, padding: '6px 12px', fontSize: 12.5, color: C.muted, cursor: 'pointer', fontFamily: body } as const;
// Buttons for the dark agent bar (proposal review).
const darkPrimaryBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: C.coral, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: body, fontSize: 12.5, fontWeight: 600 } as const;
const darkGhostBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.14)', cursor: 'pointer', fontFamily: body, fontSize: 12.5, fontWeight: 600 } as const;
