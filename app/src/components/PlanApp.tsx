'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Images, Image as ImageIcon, Mail, CalendarDays, List, Sparkles, Plus, Undo2, Trash2, CornerDownLeft, Lock } from 'lucide-react';
import type { PlanPost, PostFormat, PostStatus, ShapeResult } from '@/lib/types';

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
}

export default function PlanApp({ clientName, posts: initial }: { clientName: string; posts: PlanPost[] }) {
  const [posts, setPosts] = useState<PlanPost[]>(initial);
  const [selId, setSelId] = useState<string | null>(initial[0]?.id ?? null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 900);
    f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f);
  }, []);

  const flash = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  /** Call a structural endpoint; on success swap in the returned post set. */
  async function call(url: string, method: string, payload?: unknown): Promise<void> {
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
      .map((p) => ({ id: p.id, date: parseISO(p.date), format: p.format, pillar: p.pillar, caption: p.caption, status: p.status, script: p.script ?? null }))
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

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.navy, fontFamily: body }}>
      <header style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: narrow ? '15px 18px' : '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <SprigMark size={narrow ? 22 : 26} />
          <span style={{ fontFamily: display, fontSize: narrow ? 18 : 22, color: C.coral }}>Sprigly</span>
        </span>
        <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
          <div style={{ fontFamily: display, fontSize: narrow ? 17 : 20, color: C.navy }}>
            {clientName} · <span style={{ fontStyle: 'italic', color: C.coral }}>{MONTHS[MONTH]}</span> plan
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
            {vposts.length} posts · opened from your link, no password needed
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', maxWidth: 1240, margin: '0 auto', minHeight: 'calc(100vh - 78px)' }}>
        <section style={{ flex: narrow ? 'unset' : '0 0 52%', padding: narrow ? '20px 14px 132px' : '28px 28px 132px', borderRight: narrow ? 'none' : `1px solid ${C.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <Kicker>Your plan</Kicker>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={addDraft} disabled={busy} style={{ ...ghostBtn, padding: '7px 12px', opacity: busy ? 0.5 : 1 }}><Plus size={14} /> Add a post</button>
              <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: 3 }}>
                <Toggle active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
                <Toggle active={view === 'list'} onClick={() => setView('list')} icon={List} label="List" />
              </div>
            </div>
          </div>

          {vposts.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: C.faint, fontSize: 14, border: `1.5px dashed ${C.line}`, borderRadius: 14 }}>
              No posts yet — use <strong>Add a post</strong> to start, or your plan will appear here once it&rsquo;s generated.
            </div>
          ) : view === 'calendar' ? (
            <CalendarView posts={vposts} selId={sel?.id ?? null} onSelect={select} onReschedule={reschedule} year={YEAR} month={MONTH} mdays={MDAYS} dragId={dragId} setDragId={setDragId} />
          ) : (
            <ListView posts={vposts} selId={sel?.id ?? null} onSelect={select} />
          )}

          <Legend />
        </section>

        {!narrow && (
          <section style={{ flex: 1, padding: '28px 30px 132px' }}>
            <Detail post={sel} busy={busy} onSetFormat={setFormat} onSaveCaption={saveCaption} onRemove={remove} onRevert={revert} />
          </section>
        )}
      </div>

      {narrow && sheetOpen && sel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,42,74,.32)', zIndex: 40 }} onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88vh', overflowY: 'auto', background: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '16px 18px 80px', boxShadow: '0 -16px 44px rgba(30,42,74,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 12px' }}>
              <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line }} />
            </div>
            <Detail post={sel} busy={busy} onSetFormat={setFormat} onSaveCaption={saveCaption} onRemove={remove} onRevert={revert} />
          </div>
        </div>
      )}

      <ComingSoonBar />

      {toast && (
        <div className="toast" role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 84, zIndex: 60, background: C.navy, color: '#fff', padding: '11px 16px', borderRadius: 12, fontSize: 13.5, maxWidth: 'min(520px,92vw)', boxShadow: '0 12px 32px rgba(30,42,74,.26)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Sparkles size={15} color={C.coral} /> <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- views ---------------- */

function CalendarView({ posts, selId, onSelect, onReschedule, year, month, mdays, dragId, setDragId }: {
  posts: VPost[]; selId: string | null; onSelect: (id: string) => void; onReschedule: (id: string, day: number) => void;
  year: number; month: number; mdays: number; dragId: string | null; setDragId: (id: string | null) => void;
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
                  onDragOver={(e) => { if (day && dragId != null) { e.preventDefault(); setOver(day); } }}
                  onDragLeave={() => setOver((o) => (o === day ? null : o))}
                  onDrop={(e) => { e.preventDefault(); if (day && dragId != null) onReschedule(dragId, day); setOver(null); setDragId(null); }}
                  style={{ minHeight: 94, background: day ? (isOver ? C.coralLt : C.card) : 'transparent', border: `1px solid ${isOver ? C.coral : day ? C.line : 'transparent'}`, borderRadius: 10, padding: 6, boxShadow: day ? softShadow : 'none', transition: 'background .12s, border-color .12s' }}>
                  {day && <div style={{ fontSize: 11.5, fontWeight: 700, color: weekend ? C.coral : C.faint, marginBottom: 5, paddingLeft: 2 }}>{day}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dayPosts.map((p) => {
                      const g = group(p.pillar); const Icon = FORMAT_META[p.format].Icon; const isSel = p.id === selId;
                      return (
                        <button key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
                          onClick={() => onSelect(p.id)} className="chip-cal"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', cursor: 'grab', background: isSel ? g.fg : g.bg, color: isSel ? '#fff' : g.fg, border: `1px solid ${isSel ? g.fg : 'transparent'}`, borderLeft: `3px solid ${g.fg}`, borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 11, fontWeight: 600, lineHeight: 1.1, opacity: dragId === p.id ? 0.4 : 1 }}>
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
        <p style={{ fontSize: 12, color: C.faint, marginTop: 10 }}>Drag any post to another day to reschedule it.</p>
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
        <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{post.caption.replace(/\n+/g, ' ')}</p>
      </div>
    </button>
  );
}

/* ---------------- detail (editable) ---------------- */

function Detail({ post, busy, onSetFormat, onSaveCaption, onRemove, onRevert }: {
  post: VPost | null; busy: boolean;
  onSetFormat: (id: string, f: PostFormat) => void; onSaveCaption: (id: string, c: string) => void;
  onRemove: (id: string) => void; onRevert: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(post?.caption ?? ''); }, [post?.id, post?.caption]);
  if (!post) return null;
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
        {post.status !== 'planned' && <button onClick={() => onRevert(post.id)} disabled={busy} style={{ marginLeft: 'auto', ...textBtn }}><Undo2 size={13} /> Revert</button>}
      </div>

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
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, color: C.faint, fontSize: 12.5 }}>
        <Lock size={13} /> Instructed rewrites (&ldquo;make it softer&rdquo;) and voice arrive next — for now, edit the caption directly above.
      </div>
    </div>
  );
}
function nextFormat(f: PostFormat): PostFormat {
  if (f === 'email') return 'email';
  const i = FORMAT_CYCLE.indexOf(f);
  return FORMAT_CYCLE[(i + 1) % FORMAT_CYCLE.length]!;
}

/* ---------------- bottom bar (regen stub) ---------------- */

function ComingSoonBar() {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: C.agentBar, borderTop: '1px solid rgba(255,255,255,.07)', padding: '13px 18px', boxShadow: '0 -6px 28px rgba(30,42,74,.20)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9, color: 'rgba(255,255,255,.82)', fontSize: 13.5 }}>
        <Sparkles size={15} color={C.coral} />
        <span className="planLabel" style={{ fontFamily: display, fontSize: 14, color: '#fff' }}>Talk to your plan</span>
        <span style={{ color: 'rgba(255,255,255,.6)' }}>— arrives next. For now, move, add, edit and revert posts directly.</span>
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
