/**
 * @vitest-environment jsdom
 *
 * rescue.interaction.test.tsx — promoting several ideas from one brief's receipt.
 *
 * A fifteen-item brief files its unplaced items as ideas and the rollup offers "Add to this
 * month" against each. Clicking ONE turned all eleven to "Adding…" and then removed every link,
 * so a client could promote exactly one item per brief and never again. Two separate faults —
 * one flag for the whole surface, and the rollup being replaced by the promotion's own receipt —
 * and both are invisible to a render assertion, which is why they are driven here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ReceiptPanel } from './ReceiptPanel';
import type { DraftReceipt, BriefItem } from '../DraftPlanView';

const idea = (n: number): BriefItem => ({
  span: `${n}) an idea we filed`, outcome: 'idea', lines: [], changedIds: [], planInputId: `pi-${n}`,
});

const rollup = (n: number): DraftReceipt => ({
  id: 'r1', at: '2026-10-01T00:00:00Z', sourceText: 'a fifteen item brief', source: 'web',
  scope: 'evergreen', lines: [], changedIds: [],
  segmentCount: n, discardedCount: 0,
  items: Array.from({ length: n }, (_, i) => idea(i + 1)),
} as unknown as DraftReceipt);

/** The panel, with the two state slots `useDraftMonth` now owns. */
function Panel({ rescuingId, rescuedIds, onRescue }: {
  rescuingId?: string | null; rescuedIds?: string[]; onRescue?: (id: string) => void;
}) {
  return (
    <ReceiptPanel
      receipt={rollup(11)} monthName="October" editable
      rescuingId={rescuingId ?? null} rescuedIds={rescuedIds ?? []}
      onRescue={onRescue ?? (() => {})} onClear={() => {}}
    />
  );
}

beforeEach(() => { cleanup(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('a rollup offering eleven rescues', () => {
  it('offers one link per filed idea', () => {
    render(<Panel />);
    expect(screen.getAllByTestId('add-to-this-month')).toHaveLength(11);
  });

  it('ONE line says “Adding…” while it works — not all eleven', () => {
    render(<Panel rescuingId="pi-3" />);
    const labels = screen.getAllByTestId('add-to-this-month').map((b) => b.textContent);
    expect(labels.filter((t) => t === 'Adding…')).toHaveLength(1);
    expect(labels.filter((t) => t === 'Add to this month')).toHaveLength(10);
  });

  it('only the working line is disabled — the others stay tappable', () => {
    render(<Panel rescuingId="pi-3" />);
    const disabled = screen.getAllByTestId('add-to-this-month').filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabled).toHaveLength(1);
  });

  it('a promoted line reports itself done and the other ten KEEP their links', () => {
    render(<Panel rescuedIds={['pi-3']} />);
    expect(screen.getAllByTestId('added-to-this-month')).toHaveLength(1);
    // The regression: this used to be 0, because the rollup had been replaced wholesale.
    expect(screen.getAllByTestId('add-to-this-month')).toHaveLength(10);
  });

  it('promoting a second and a third leaves the rest usable', () => {
    render(<Panel rescuedIds={['pi-1', 'pi-2', 'pi-3']} />);
    expect(screen.getAllByTestId('added-to-this-month')).toHaveLength(3);
    expect(screen.getAllByTestId('add-to-this-month')).toHaveLength(8);
  });

  it('each link promotes ITS OWN idea', () => {
    const onRescue = vi.fn();
    render(<Panel onRescue={onRescue} />);
    const links = screen.getAllByTestId('add-to-this-month');
    fireEvent.click(links[4]!);
    fireEvent.click(links[9]!);
    expect(onRescue.mock.calls.map((c) => c[0])).toEqual(['pi-5', 'pi-10']);
  });

  it('a resolved line cannot be tapped again', async () => {
    const onRescue = vi.fn();
    const { rerender } = render(<Panel onRescue={onRescue} />);
    fireEvent.click(screen.getAllByTestId('add-to-this-month')[0]!);
    expect(onRescue).toHaveBeenCalledWith('pi-1');
    rerender(<Panel rescuedIds={['pi-1']} onRescue={onRescue} />);
    await waitFor(() => expect(screen.getAllByTestId('added-to-this-month')).toHaveLength(1));
    // Nothing left to click on that line; the count of live links dropped by exactly one.
    expect(screen.getAllByTestId('add-to-this-month')).toHaveLength(10);
  });
});
