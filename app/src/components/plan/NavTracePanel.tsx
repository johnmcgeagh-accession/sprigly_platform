'use client';

/**
 * NavTracePanel.tsx — the navigation event log, on the screen where the jump lives.
 *
 * `MicTracePanel`'s twin for `nav-trace.ts`. Renders nothing at all unless `?nav=trace` armed
 * the trace for this tab, so it is safe to leave in the build. Deliberately ugly and not
 * token-styled, for the same reason as the mic panel: it is an instrument, not the product,
 * and it names itself in its first line so a screenshot cannot be mistaken for the surface.
 */
import React, { useEffect, useState } from 'react';
import { navTraceEnabled, navTraceEntries, navTraceClear, navTraceText, onNavTrace, type NavTraceEntry } from './nav-trace';

export function NavTracePanel() {
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<NavTraceEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Armed state is read after mount: the flag comes off `location`, which the server does not
   * have, and rendering it during SSR would mismatch.
   *
   * ROUND 4: the subscription is UNCONDITIONAL. It used to return early when the trace was off,
   * which meant arming it mid-session (the wordmark's triple tap) did nothing until something
   * else re-rendered the shell. On a surface whose bug is a navigation, "it appears after you
   * navigate" is an instrument that hides exactly when it is needed.
   */
  useEffect(() => {
    const sync = () => { setOn(navTraceEnabled()); setRows(navTraceEntries()); };
    sync();
    return onNavTrace(sync);
  }, []);

  if (!on) return null;

  return (
    <div
      data-testid="nav-trace"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2147483646,
        maxHeight: collapsed ? 34 : '40vh', overflow: 'auto',
        background: 'rgba(16,10,12,.94)', color: '#F5E4D8',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))',
        borderTop: '2px solid #E0A04D',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', top: 0 }}>
        <strong style={{ color: '#E0A04D' }}>nav trace</strong>
        <span style={{ opacity: 0.6 }}>{rows.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setCollapsed((v) => !v)} style={BTN}>{collapsed ? 'show' : 'hide'}</button>
        <button
          type="button" style={BTN}
          onClick={() => {
            void navigator.clipboard?.writeText(navTraceText())
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
              .catch(() => {});
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <button type="button" onClick={() => navTraceClear()} style={BTN}>clear</button>
      </div>
      {!collapsed && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
          <tbody>
            {rows.map((r, i) => {
              // THE RED LINE. A suspect row is the one thing this instrument is for, and the
              // deliverable is a SCREENSHOT of it — so the whole row carries the tone, the call
              // site included. It used to sit at opacity 0.5, which is the one cell the operator
              // has to be able to read back off a photograph of a phone.
              const tone = TONE(r.ev);
              const suspect = tone === SUSPECT;
              return (
                <tr key={i} style={suspect ? { background: 'rgba(255,138,122,.12)' } : undefined}>
                  <td style={{ textAlign: 'right', paddingRight: 8, opacity: 0.55, whiteSpace: 'nowrap' }}>{r.t}</td>
                  <td style={{ paddingRight: 8, color: tone, whiteSpace: 'nowrap', fontWeight: suspect ? 700 : 400 }}>{r.ev}</td>
                  <td style={{ opacity: 0.8 }}>{r.detail ?? ''}</td>
                  {/* WHO CALLED. A reason is what the call site claims; this is what it is, and
                      the two disagreeing is how the next unfound mover gets caught. */}
                  <td style={{ color: suspect ? tone : undefined, opacity: suspect ? 1 : 0.5, whiteSpace: 'nowrap', paddingLeft: 8 }}>
                    {r.from ?? ''}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={4} style={{ opacity: 0.6 }}>nothing yet — move around the plan</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

const BTN: React.CSSProperties = {
  font: 'inherit', color: '#F5E4D8', background: 'transparent',
  border: '1px solid rgba(245,228,216,.35)', borderRadius: 4, padding: '2px 7px', minHeight: 24,
};

/** The tone of a row that no gesture explains — the line this instrument exists for. */
const SUSPECT = '#FF8A7A';

/** A position change that no gesture caused is the line this instrument exists for. */
function TONE(ev: string): string {
  if (ev.includes('user:')) return '#A8E8B8';           // a gesture — expected
  if (ev.includes('restore:')) return '#8CC8E8';        // the persistence putting you back
  if (ev.includes('mount') || ev.includes('land')) return '#F5E4D8';
  return SUSPECT;                                       // anything else moved the surface — the bug
}
