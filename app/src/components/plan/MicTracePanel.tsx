'use client';

/**
 * MicTracePanel.tsx — the microphone's event log, on the screen where the bug lives.
 *
 * Renders nothing at all unless `?mic=trace` armed the trace for this tab (`mic-trace.ts`), so
 * it is safe to leave in the build: a client can never reach it, and the operator reaches it by
 * typing eight characters onto the end of their own link.
 *
 * It is deliberately ugly and deliberately not token-styled. It is an instrument, not part of
 * the surface, and it needs to be legible over whatever it is covering — a panel that quietly
 * matched the design would be one the operator could mistake for the product in a screenshot.
 * For the same reason it names itself in the first line.
 *
 * Copy puts the whole log on the clipboard, which is how it gets from the phone into the report.
 */
import React, { useEffect, useState } from 'react';
import { micTraceEnabled, micTraceEntries, micTraceClear, micTraceText, onMicTrace, type MicTraceEntry } from './mic-trace';

export function MicTracePanel() {
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<MicTraceEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Armed state is read after mount: the flag comes off `location`, which the server does not
  // have, and rendering it during SSR would mismatch.
  useEffect(() => {
    if (!micTraceEnabled()) return;
    setOn(true);
    setRows(micTraceEntries());
    return onMicTrace(() => setRows(micTraceEntries()));
  }, []);

  if (!on) return null;

  return (
    <div
      data-testid="mic-trace"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2147483647,
        maxHeight: collapsed ? 34 : '46vh', overflow: 'auto',
        background: 'rgba(10,12,16,.94)', color: '#D8F5EC',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))',
        borderTop: '2px solid #4DB0A0',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'sticky', top: 0 }}>
        <strong style={{ color: '#4DB0A0' }}>mic trace</strong>
        <span style={{ opacity: 0.6 }}>{rows.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setCollapsed((v) => !v)} style={BTN}>{collapsed ? 'show' : 'hide'}</button>
        <button
          type="button" style={BTN}
          onClick={() => {
            void navigator.clipboard?.writeText(micTraceText())
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
              .catch(() => {});
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <button type="button" onClick={() => micTraceClear()} style={BTN}>clear</button>
      </div>
      {!collapsed && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ textAlign: 'right', paddingRight: 8, opacity: 0.55, whiteSpace: 'nowrap' }}>{r.t}</td>
                <td style={{ paddingRight: 8, color: TONE(r.ev), whiteSpace: 'nowrap' }}>{r.ev}</td>
                <td style={{ opacity: 0.8 }}>{r.detail ?? ''}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={3} style={{ opacity: 0.6 }}>nothing yet — open the mic</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

const BTN: React.CSSProperties = {
  font: 'inherit', color: '#D8F5EC', background: 'transparent',
  border: '1px solid rgba(216,245,236,.35)', borderRadius: 4, padding: '2px 7px', minHeight: 24,
};

/** The three lines that matter are the three that are coloured: a death, a second capture, a word. */
function TONE(ev: string): string {
  if (ev.includes('error') || ev.includes('threw') || ev.includes('fail')) return '#FF8A7A';
  if (ev.startsWith('gum:')) return '#FFD479';
  if (ev === 'rec:end' || ev === 'rec:audioend') return '#FFD479';
  if (ev === 'rec:result' || ev === 'rec:audiostart') return '#8CE8C8';
  return '#D8F5EC';
}
