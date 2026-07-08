'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focus management for a modal layer (Sheet/Drawer): when `active`, move focus inside,
 * trap Tab within, close on Escape (stopping propagation so only the top-most layer
 * reacts), and restore focus to the opener on close.
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => (el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null) : []);

    const t = setTimeout(() => { const f = focusables(); (f[0] ?? el)?.focus(); }, 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) { e.preventDefault(); el?.focus(); return; }
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    el?.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      el?.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [active, ref, onClose]);
}
