'use client';

import React, { useEffect, useRef } from 'react';
import { Scrim, Sheet } from './primitives';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = [2025, 2026, 2027, 2028];
const ROW = 44;

function Wheel({ items, index, wheelRef }: { items: (string | number)[]; index: number; wheelRef: React.RefObject<HTMLDivElement> }) {
  const mark = (el: HTMLDivElement) => {
    const i = Math.round(el.scrollTop / ROW);
    el.querySelectorAll<HTMLElement>('[data-opt]').forEach((o) => o.classList.toggle('on', Number(o.dataset['opt']) === i));
  };
  useEffect(() => {
    const el = wheelRef.current; if (!el) return;
    el.scrollTop = index * ROW; mark(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  return (
    <div
      ref={wheelRef}
      className="relative z-[1] flex-1 snap-y snap-mandatory overflow-y-scroll text-center [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(180deg,transparent,#000_32%,#000_68%,transparent)]"
      style={{ WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 32%,#000 68%,transparent)' }}
      onScroll={(e) => mark(e.currentTarget)}
    >
      <div style={{ height: 76 }} />
      {items.map((it, i) => (
        <div key={i} data-opt={i} onClick={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="flex h-11 snap-center cursor-pointer items-center justify-center text-[17px] font-semibold text-muted transition-[color,font-weight] [&.on]:text-[18px] [&.on]:font-extrabold [&.on]:text-slate-700">
          {it}
        </div>
      ))}
      <div style={{ height: 76 }} />
    </div>
  );
}

export function MonthWheelPicker({ show, year, month, onDone, onClose }: {
  show: boolean; year: number; month: number;
  onDone: (year: number, month: number) => void; onClose: () => void;
}) {
  const mRef = useRef<HTMLDivElement>(null);
  const yRef = useRef<HTMLDivElement>(null);
  const done = () => {
    const mi = mRef.current ? Math.round(mRef.current.scrollTop / ROW) : month;
    const yi = yRef.current ? Math.round(yRef.current.scrollTop / ROW) : 0;
    onDone(YEARS[yi] ?? year, Math.min(11, Math.max(0, mi)));
  };
  return (
    <>
      <Scrim show={show} onClick={onClose} />
      <Sheet show={show} onClose={onClose} testid="month-picker" className="px-5 pb-6 pt-0" label="Jump to month">
        <h3 className="mb-1 mt-1.5 text-center font-serif text-xl text-slate-700">Jump to month</h3>
        <div className="relative my-2.5 flex h-[196px] gap-2.5 before:absolute before:inset-x-0 before:top-1/2 before:z-0 before:h-11 before:-translate-y-1/2 before:rounded-xl before:bg-coral-tint before:content-['']">
          <Wheel items={MONTHS} index={month} wheelRef={mRef} />
          <Wheel items={YEARS} index={Math.max(0, YEARS.indexOf(year))} wheelRef={yRef} />
        </div>
        <button data-testid="month-picker-done" onClick={done}
          className="mt-3 w-full rounded-2xl bg-coral py-3.5 text-[15px] font-extrabold text-white shadow-coral">Done</button>
      </Sheet>
    </>
  );
}
