'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Film, Images, Image as ImageIcon, Mail, CalendarDays, List, Sparkles, Lock } from 'lucide-react';
import type { PlanPost, PostFormat, PostStatus } from '@/lib/types';

/* ------------------------------------------------------------------ *
 * Sprigly — client plan surface (app.sprigly.co.uk). Phase 1: read-only
 * render of the real cycle. Ported from sprigly-client-app.jsx; shaping
 * (edits / talk-to-your-plan) is disabled here and lands in Phase 2+.
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

function group(pillar: string) {
  const p = (pillar || '').toLowerCase();
  if (/(product|launch|offer)/.test(p)) return { fg: C.coral, bg: C.coralLt };
  if (/(ethic|educat|sustain|origin|made|cotton)/.test(p)) return { fg: C.slate, bg: C.slateLt };
  if (/(sunday|weekend|style|styling)/.test(p)) return { fg: C.navy, bg: C.navyLt };
  if (/(personal|founder|relationship|need|story)/.test(p)) return { fg: C.coralDeep, bg: C.coralLt };
  return { fg: C.slate, bg: C.slateLt };
}
const shortPillar = (pillar: string) => (pillar || 'Post').split(/\s+/)[0];

/** Parse 'YYYY-MM-DD' as a LOCAL date (avoid the UTC-midnight day-shift). */
function parseISO(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, day || 1);
}

interface VPost {
  id: string; date: Date; format: PostFormat; pillar: string;
  caption: string; status: PostStatus; script: string | null;
}

export default function PlanApp({ clientName, posts }: { clientName: string; posts: PlanPost[] }) {
  const vposts = useMemo<VPost[]>(
    () =>
      [...posts]
        .map((p) => ({ id: p.id, date: parseISO(p.date), format: p.format, pillar: p.pillar, caption: p.caption, status: p.status, script: p.script ?? null }))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [posts],
  );

  // Calendar month derived from the plan itself (all posts fall in the plan month).
  const anchor = vposts[0]?.date ?? new Date();
  const YEAR = anchor.getFullYear();
  const MONTH = anchor.getMonth();
  const MDAYS = new Date(YEAR, MONTH + 1, 0).getDate();

  const [selId, setSelId] = useState<string | null>(vposts[0]?.id ?? null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 900);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  const sel = vposts.find((p) => p.id === selId) ?? vposts[0] ?? null;
  const select = (id: string) => { setSelId(id); if (narrow) setSheetOpen(true); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.navy, fontFamily: body }}>
      <header style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: narrow ? '15px 18px' : '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: display, fontSize: narrow ? 18 : 22, color: C.coral }}>Sprigly</span>
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
            <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: 3 }}>
              <Toggle active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
              <Toggle active={view === 'list'} onClick={() => setView('list')} icon={List} label="List" />
            </div>
          </div>

          {vposts.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: C.faint, fontSize: 14, border: `1.5px dashed ${C.line}`, borderRadius: 14 }}>
              Your plan for this month isn&rsquo;t ready to view here yet.
            </div>
          ) : view === 'calendar' ? (
            <CalendarView posts={vposts} selId={sel?.id ?? null} onSelect={select} year={YEAR} month={MONTH} mdays={MDAYS} />
          ) : (
            <ListView posts={vposts} selId={sel?.id ?? null} onSelect={select} />
          )}

          <Legend />
        </section>

        {!narrow && (
          <section style={{ flex: 1, padding: '28px 30px 132px' }}>
            <Detail post={sel} />
          </section>
        )}
      </div>

      {narrow && sheetOpen && sel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,42,74,.32)', zIndex: 40 }} onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88vh', overflowY: 'auto', background: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '16px 18px 80px', boxShadow: '0 -16px 44px rgba(30,42,74,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 12px' }}>
              <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line }} />
            </div>
            <Detail post={sel} />
          </div>
        </div>
      )}

      <ComingSoonBar />
    </div>
  );
}

/* ---------------- views ---------------- */

function CalendarView({ posts, selId, onSelect, year, month, mdays }: { posts: VPost[]; selId: string | null; onSelect: (id: string) => void; year: number; month: number; mdays: number }) {
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
          {WK_MON.map((d) => (
            <div key={d} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.faint, textAlign: 'center' }}>{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 7, marginBottom: 7 }}>
            {week.map((day, di) => {
              const dayPosts = day ? byDay[day] || [] : [];
              const weekend = di >= 5;
              return (
                <div key={di} style={{ minHeight: 94, background: day ? C.card : 'transparent', border: `1px solid ${day ? C.line : 'transparent'}`, borderRadius: 10, padding: 6, boxShadow: day ? softShadow : 'none' }}>
                  {day && <div style={{ fontSize: 11.5, fontWeight: 700, color: weekend ? C.coral : C.faint, marginBottom: 5, paddingLeft: 2 }}>{day}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dayPosts.map((p) => {
                      const g = group(p.pillar);
                      const Icon = FORMAT_META[p.format].Icon;
                      const isSel = p.id === selId;
                      return (
                        <button key={p.id} onClick={() => onSelect(p.id)} className="chip-cal"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', cursor: 'pointer', background: isSel ? g.fg : g.bg, color: isSel ? '#fff' : g.fg, border: `1px solid ${isSel ? g.fg : 'transparent'}`, borderLeft: `3px solid ${g.fg}`, borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 11, fontWeight: 600, lineHeight: 1.1 }}>
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
      </div>
    </div>
  );
}

function ListView({ posts, selId, onSelect }: { posts: VPost[]; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      {posts.map((p, i, a) => (
        <SprigRow key={p.id} post={p} first={i === 0} last={i === a.length - 1} selected={p.id === selId} onClick={() => onSelect(p.id)} />
      ))}
    </div>
  );
}

function SprigRow({ post, first, last, selected, onClick }: { post: VPost; first: boolean; last: boolean; selected: boolean; onClick: () => void }) {
  const Icon = FORMAT_META[post.format].Icon;
  const g = group(post.pillar);
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

/* ---------------- detail ---------------- */

function Detail({ post }: { post: VPost | null }) {
  if (!post) return null;
  const Icon = FORMAT_META[post.format].Icon;
  const g = group(post.pillar);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: g.bg, color: g.fg, padding: '5px 11px', borderRadius: 9, fontSize: 12.5, fontWeight: 600 }}><Icon size={14} /> {FORMAT_META[post.format].label}</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>{post.pillar}</span>
        <span style={{ color: C.line }}>·</span>
        <span style={{ fontFamily: display, fontSize: 16, color: C.navy }}>{`${WK[post.date.getDay()]} ${MONTHS[post.date.getMonth()]} ${post.date.getDate()}`}</span>
        <StatusTag status={post.status} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 20px', whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.62, color: C.navy, boxShadow: softShadow }}>{post.caption}</div>

      <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
        {post.script && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Film size={14} color={C.coralDeep} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.coralDeep }}>Reel script</span>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: body, fontSize: 13.5, lineHeight: 1.6, color: C.navy }}>{post.script}</pre>
          </div>
        )}
        <div style={{ border: `1.5px dashed ${C.line}`, borderRadius: 14, padding: '18px 16px', textAlign: 'center', color: C.faint, fontSize: 13 }}>
          Video preview — coming soon. The slot&rsquo;s here so it&rsquo;s ready when the capability lands.
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 8, color: C.faint, fontSize: 12.5 }}>
        <Lock size={13} /> Shaping this post &mdash; editing, tone, dates &mdash; arrives next.
      </div>
    </div>
  );
}

/* ---------------- bottom bar (disabled in Phase 1) ---------------- */

function ComingSoonBar() {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: C.agentBar, borderTop: '1px solid rgba(255,255,255,.07)', padding: '13px 18px', boxShadow: '0 -6px 28px rgba(30,42,74,.20)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 9, color: 'rgba(255,255,255,.82)', fontSize: 13.5 }}>
        <Sparkles size={15} color={C.coral} />
        <span className="planLabel" style={{ fontFamily: display, fontSize: 14, color: '#fff' }}>Talk to your plan</span>
        <span style={{ color: 'rgba(255,255,255,.6)' }}>— arrives next. You&rsquo;ll shape your plan by text or voice, right here.</span>
      </div>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

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
      {items.map(([l, c]) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} /> {l}
        </span>
      ))}
    </div>
  );
}
