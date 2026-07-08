'use client';

import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './icons';
import { useFocusTrap } from './a11y';

/** A dimmed backdrop. `soft` = light scrim (editor drawer keeps the plan legible). */
export function Scrim({ show, soft, onClick }: { show: boolean; soft?: boolean; onClick?: () => void }) {
  return (
    <div
      data-testid="scrim" aria-hidden="true"
      onClick={onClick}
      className={[
        'fixed inset-0 z-[60] transition-opacity duration-300',
        soft ? 'bg-ink/15' : 'bg-ink/40 backdrop-blur-[2px]',
        show ? 'opacity-100' : 'pointer-events-none opacity-0',
      ].join(' ')}
    />
  );
}

/** Bottom sheet (mobile pattern + desktop agent). Focus-trapped, Escape-closable. */
export function Sheet({
  show, onClose, children, heightClass = '', className = '', testid = 'sheet', labelledBy, label,
}: {
  show: boolean; onClose: () => void; children: React.ReactNode;
  heightClass?: string; className?: string; testid?: string; labelledBy?: string; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(show, ref, onClose);
  // When closed, `inert` removes the (off-screen) content from the a11y tree and tab
  // order — no aria-hidden-focus violation, no tabbing to hidden controls.
  useEffect(() => { const el = ref.current as (HTMLElement & { inert: boolean }) | null; if (el) el.inert = !show; }, [show]);
  return (
    <div
      ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} data-testid={testid} tabIndex={-1}
      className={[
        'fixed inset-x-0 bottom-0 z-[61] flex flex-col rounded-t-[26px] bg-surface shadow-sheet outline-none',
        'transition-transform duration-[420ms] ease-sheet',
        heightClass, className,
        show ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      ].join(' ')}
    >
      <div className="mx-auto mt-2.5 h-[5px] w-11 flex-none rounded-full bg-[#E2DED9]" aria-hidden="true" />
      <button data-testid="sheet-close" onClick={onClose} aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-slate-700 hover:bg-[#E9E6E1]">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

/** Right drawer (desktop editor). Focus-trapped, Escape-closable; plan stays visible. */
export function Drawer({
  show, onClose, children, testid = 'drawer', labelledBy, label,
}: { show: boolean; onClose: () => void; children: React.ReactNode; testid?: string; labelledBy?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(show, ref, onClose);
  useEffect(() => { const el = ref.current as (HTMLElement & { inert: boolean }) | null; if (el) el.inert = !show; }, [show]);
  return (
    <div
      ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} data-testid={testid} tabIndex={-1}
      className={[
        'fixed inset-y-0 right-0 z-[61] flex w-[min(560px,46vw)] flex-col border-l border-line bg-surface outline-none',
        'shadow-[-24px_0_60px_-18px_rgba(27,36,48,0.3)] transition-transform duration-[400ms] ease-sheet',
        show ? 'translate-x-0' : 'pointer-events-none translate-x-[103%]',
      ].join(' ')}
    >
      <button data-testid="drawer-close" onClick={onClose} aria-label="Close"
        className="absolute right-[18px] top-4 z-[2] flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-slate-700 hover:bg-[#E9E6E1]">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

/** Transient status pill, announced politely to assistive tech. */
export function Toast({ message }: { message: string | null }) {
  return (
    <div
      data-testid="toast" role="status" aria-live="polite" aria-atomic="true"
      className={[
        'toast fixed bottom-[34px] left-1/2 z-[80] -translate-x-1/2 rounded-full bg-ink px-5 py-3',
        'text-[13.5px] font-medium text-white shadow-sheet transition-all duration-200',
        message ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      ].join(' ')}
    >
      {message}
    </div>
  );
}

/** Two-way segmented control (Plan | Tasks) — an ARIA tablist with a sliding pill. */
export function SegmentedControl<T extends string>({
  value, options, onChange, className = '', label,
}: {
  value: T; options: { value: T; label: string; dot?: boolean }[];
  onChange: (v: T) => void; className?: string; label?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const w = wrap.current, p = pill.current;
    if (!w || !p) return;
    const active = w.querySelector<HTMLButtonElement>(`[aria-selected="true"]`);
    if (!active) return;
    p.style.width = `${active.offsetWidth}px`;
    p.style.transform = `translateX(${active.offsetLeft - 4}px)`;
  }, [value, options]);

  return (
    <div ref={wrap} role="tablist" aria-label={label ?? 'View'} data-testid="segmented" className={`relative inline-flex rounded-full bg-[#ECEAE6] p-1 ${className}`}>
      <span ref={pill} aria-hidden="true" className="absolute inset-y-1 left-1 z-[1] rounded-full bg-surface shadow-card transition-[transform,width] duration-300 ease-sheet" />
      {options.map((o) => (
        <button
          key={o.value} role="tab" aria-selected={value === o.value} data-testid={`seg-${o.value}`}
          onClick={() => onChange(o.value)}
          className={[
            'relative z-[2] inline-flex items-center gap-1.5 rounded-full px-6 py-2 text-[13px] font-bold transition-colors',
            value === o.value ? 'text-slate-700' : 'text-muted',
          ].join(' ')}
        >
          {o.label}
          {o.dot && <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
