'use client';

import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './icons';
import { useFocusTrap } from './a11y';

/**
 * Disabled state for FILLED / primary buttons (coral, coral-cta, slate, coral-tint): a
 * neutral inactive treatment — `line-soft` fill (#F1EFEC) + `muted` text (#5C6470), and no
 * shadow. It reads as clearly inactive rather than a washed-out coral (which is what
 * `disabled:opacity-50` gave). No opacity. Secondary/outline buttons (border + surface)
 * keep their own subtle disabled treatment. Convention recorded in DECISIONS §25.
 */
export const DISABLED_PRIMARY = 'disabled:bg-line-soft disabled:text-muted disabled:shadow-none';

/** A dimmed backdrop. `soft` = light scrim (editor drawer keeps the plan legible). */
export function Scrim({ show, soft, onClick }: { show: boolean; soft?: boolean; onClick?: () => void }) {
  return (
    <div
      data-testid="scrim" aria-hidden="true"
      onClick={onClick}
      className={[
        'fixed inset-0 z-[60] transition-opacity duration-300',
        soft ? 'bg-slate-700/15' : 'bg-slate-700/40 backdrop-blur-[2px]',
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
      <div className="mx-auto mt-2.5 h-[5px] w-11 flex-none rounded-full bg-line" aria-hidden="true" />
      <button data-testid="sheet-close" onClick={onClose} aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-slate-700 hover:bg-coral-100">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

/** Centred modal dialog (desktop agent). A fixed-width card centred horizontally and set in
 *  the upper third, rounded on all corners, focus-trapped + Escape-closable. The entrance is
 *  a fade + slight rise/scale (killed by the reduced-motion scoped reset). The outer wrapper
 *  is pointer-events-none so clicks outside the card fall through to the Scrim behind it. */
export function Dialog({
  show, onClose, children, className = '', testid = 'dialog', labelledBy, label,
}: { show: boolean; onClose: () => void; children: React.ReactNode; className?: string; testid?: string; labelledBy?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(show, ref, onClose);
  useEffect(() => { const el = ref.current as (HTMLElement & { inert: boolean }) | null; if (el) el.inert = !show; }, [show]);
  return (
    <div className="pointer-events-none fixed inset-0 z-[61] flex items-start justify-center px-4 pt-[12vh]">
      <div
        ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} data-testid={testid} tabIndex={-1}
        className={[
          'relative flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[24px] bg-surface shadow-sheet outline-none',
          // Animate TRANSFORM only (a scale + rise). Opacity flips instantly so the modal is
          // full-contrast the moment it's visible — axe/toBeVisible don't wait out a fade.
          'origin-top transition-transform duration-300 ease-sheet',
          show ? 'pointer-events-auto scale-100 opacity-100 translate-y-0' : 'pointer-events-none scale-[0.98] opacity-0 translate-y-3',
          className,
        ].join(' ')}
      >
        <button data-testid="dialog-close" onClick={onClose} aria-label="Close"
          className="absolute right-4 top-4 z-[2] flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-slate-700 hover:bg-coral-100">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
        {children}
      </div>
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
        'shadow-[-24px_0_60px_-18px_rgba(51,65,85,0.3)] transition-transform duration-[400ms] ease-sheet',
        show ? 'translate-x-0' : 'pointer-events-none translate-x-[103%]',
      ].join(' ')}
    >
      <button data-testid="drawer-close" onClick={onClose} aria-label="Close"
        className="absolute right-[18px] top-4 z-[2] flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-slate-700 hover:bg-coral-100">
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
        'toast fixed bottom-[34px] left-1/2 z-[80] -translate-x-1/2 rounded-full bg-slate-700 px-5 py-3',
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
    <div ref={wrap} role="tablist" aria-label={label ?? 'View'} data-testid="segmented" className={`relative inline-flex rounded-full bg-line/20 p-1 ${className}`}>
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
          {o.dot && <span className="inline-block h-1.5 w-1.5 rounded-full bg-coral-600" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
