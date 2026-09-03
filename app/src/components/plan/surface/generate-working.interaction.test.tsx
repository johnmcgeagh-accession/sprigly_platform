/**
 * @vitest-environment jsdom
 *
 * generate-working.interaction.test.tsx — the Generate dialog, and the run it starts.
 *
 * The sheet used to sit on "Starting…" until the fan-out had been enqueued and the redirect
 * fired: a modal with a dead button on it, over the one action that spends money and cannot be
 * undone. Same shape the intake wizard had (4f51edd) and the same correction — close on submit,
 * show the work on the month.
 *
 * The half that is NOT the wizard is the reload. Generation runs for minutes, the client closes
 * the tab, and an indicator held in React state would be gone when they came back. So the
 * working state is derived from `readGenerationStatus` and these pin that it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act, renderHook, waitFor } from '@testing-library/react';
import { MonthWorking } from './MonthWorking';
import { useApproval } from './ApprovalSheet';

beforeEach(() => { cleanup(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MonthWorking — two intensities, one treatment', () => {
  const inner = <div data-testid="inner">the month</div>;

  it('BLOCKING dims the region and takes it out of reach — the wizard case, unchanged', () => {
    render(<MonthWorking working label="w">{inner}</MonthWorking>);
    const region = screen.getByTestId('month-working').firstElementChild as HTMLElement;
    expect(region.className).toContain('opacity-60');
    expect((region as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(screen.getByTestId('month-working-veil').className).toContain('items-center');
  });

  it('NON-BLOCKING leaves the month readable and usable — a five-minute wait must not lock it', () => {
    render(<MonthWorking working blocking={false} label="w">{inner}</MonthWorking>);
    const region = screen.getByTestId('month-working').firstElementChild as HTMLElement;
    expect(region.className).not.toContain('opacity-60');
    expect((region as HTMLElement & { inert: boolean }).inert).toBe(false);
    // Out of the way at the foot, and not swallowing taps meant for the week underneath.
    const veil = screen.getByTestId('month-working-veil');
    expect(veil.className).toContain('items-end');
    expect(veil.className).toContain('pointer-events-none');
  });

  it('shows progress when given it, and nothing when not', () => {
    const { rerender } = render(<MonthWorking working label="w" detail="18 of 31 written">{inner}</MonthWorking>);
    expect(screen.getByTestId('month-working-detail').textContent).toBe('18 of 31 written');
    rerender(<MonthWorking working label="w">{inner}</MonthWorking>);
    expect(screen.queryByTestId('month-working-detail')).toBeNull();
  });

  it('renders nothing at all when not working', () => {
    render(<MonthWorking working={false} label="w" detail="x">{inner}</MonthWorking>);
    expect(screen.queryByTestId('month-working-veil')).toBeNull();
    expect(screen.getByTestId('inner')).toBeTruthy();
  });
});

describe('useApproval — the dialog closes on submit', () => {
  it('closes BEFORE the request resolves, and reports itself starting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return { ok: true, json: async () => ({ ok: true }) }; }));
    vi.stubGlobal('location', { assign: vi.fn() } as unknown as Location);

    const { result } = renderHook(() => useApproval('cyc-1'));
    act(() => { result.current.setOpen(true); });
    expect(result.current.open).toBe(true);

    act(() => { void result.current.approve(); });
    // The point of the whole change: gone while the server is still working.
    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.starting).toBe(true);
    act(() => { release(); });
  });

  it('a REFUSAL brings the sheet back carrying its reason — closing must not lose it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, message: 'Not enough beats.' }) })));
    const { result } = renderHook(() => useApproval('cyc-1'));
    act(() => { result.current.setOpen(true); });
    await act(async () => { await result.current.approve(); });
    expect(result.current.open).toBe(true);
    expect(result.current.error).toBe('Not enough beats.');
    expect(result.current.starting).toBe(false);
  });

  it('a network failure does the same', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { result } = renderHook(() => useApproval('cyc-1'));
    await act(async () => { await result.current.approve(); });
    expect(result.current.open).toBe(true);
    expect(result.current.error).toMatch(/couldn’t reach the server/);
    expect(result.current.starting).toBe(false);
  });

  it('“Not yet” is untouched — setOpen(false) with nothing sent', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useApproval('cyc-1'));
    act(() => { result.current.setOpen(true); });
    act(() => { result.current.setOpen(false); });
    expect(result.current.open).toBe(false);
    expect(result.current.starting).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays BUSY for the whole flight — what keeps the button disabled and the tap unrepeatable', async () => {
    // Re-entry is guarded by `disabled={busy}` on the control, not by same-tick state: two
    // calls in one tick both read the pre-render value. What this pins is the thing the DOM
    // relies on — busy is true from submit until the request settles, so there is no frame in
    // which a live button exists over an approval already in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return { ok: true, json: async () => ({ ok: true }) }; }));
    vi.stubGlobal('location', { assign: vi.fn() } as unknown as Location);

    const { result } = renderHook(() => useApproval('cyc-1'));
    act(() => { void result.current.approve(); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.open).toBe(false);
    act(() => { release(); });
  });
});
