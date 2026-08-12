/**
 * @vitest-environment jsdom
 *
 * brief-on-draft.interaction.test.tsx — briefing a month that already exists.
 *
 * Two surfaces used to be mutually exclusive by TREE POSITION: `PlanRoot` returned the draft
 * surface before the fragment that mounts `IntakeCapture`, so on a draft month the wizard could
 * not be opened at all — not by `?intake=1`, and not by `openIntake`, which had no caller
 * anywhere in the tree. A client looking at a proposed month could change it one sentence at a
 * time or not at all.
 *
 * These are the properties that make the wizard usable there, and each is a thing that was
 * wrong: it MOUNTS over a draft, it opens EMPTY, it shows the month as context instead of the
 * stored sentence, and a save that reshaped the month closes so the client can see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, PRE_PLANNING_STATUSES: new Set(['scheduled']) }));
vi.mock('./useLivePreview', () => ({ useLivePreview: () => ({ preview: null, loading: false, schedule: () => {} }) }));
// The full shape (useSpeechInput.ts:279) — the committed surface's VoiceSheet calls `stop` in a
// mount effect, so a partial stub fails there and not on the draft branch.
vi.mock('./useSpeechInput', () => ({
  useSpeechInput: () => ({
    state: 'idle', listening: false, audioLive: false, speaking: false, partial: '',
    start: () => {}, stop: () => {}, toggle: () => {},
  }),
}));

import { IntakeCapture } from './IntakeCapture';
import { DraftMonthSummary } from './surface/DraftMonthSummary';
import { PlanRoot } from './PlanRoot';
import type { PlanDataInit } from './usePlanData';
import type { DraftBeatView, PlanIntake, IntakeResult } from '@/lib/types';

const BEATS: DraftBeatView[] = [
  { id: 'b2', cycleId: 'c1', date: '2026-09-20', format: 'single', pillar: 'Ritual', title: 'Sunday Style', position: 1, slotType: 'proven', evidence: { basis: 'template' }, assumptions: [] },
  { id: 'b1', cycleId: 'c1', date: '2026-09-08', format: 'reel', pillar: 'Home', title: 'Launch build-up', position: 0, slotType: 'proven', evidence: { basis: 'template' }, assumptions: [] },
];

const INTAKE: PlanIntake = { answers: {}, freeNotes: 'A launch on the 8th, keep it calm after.' } as unknown as PlanIntake;

function renderWizard(over: Partial<React.ComponentProps<typeof IntakeCapture>> = {}) {
  const onSubmit = vi.fn(async (): Promise<IntakeResult> => ({ ok: true, mode: 'brief_updated', draftApplied: true }));
  const onClose = vi.fn();
  render(
    <IntakeCapture
      questions={['Q1']} cycleId="c1" prePlanning busy={false} monthLabel="September 2026"
      intake={INTAKE} savedExtraction={null} durable={[]} cutoffLabel="18 August"
      onSubmit={onSubmit} onClose={onClose}
      {...over}
    />,
  );
  return { onSubmit, onClose };
}

afterEach(() => cleanup());
beforeEach(() => { window.innerWidth = 1280; });

describe('the composer on a DRAFT month', () => {
  it('opens EMPTY — the stored sentence is not seeded back over a month that has moved on', () => {
    renderWizard({ draftMonth: true, currentBeats: BEATS });
    expect((screen.getByTestId('intake-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('still seeds from the saved brief when there is NO draft — last session\'s behaviour, unchanged', () => {
    renderWizard({ draftMonth: false });
    expect((screen.getByTestId('intake-input') as HTMLTextAreaElement).value)
      .toBe('A launch on the 8th, keep it calm after.');
  });

  it('shows the current month as context, oldest first, with a count', () => {
    renderWizard({ draftMonth: true, currentBeats: BEATS });
    const panel = screen.getByTestId('intake-current-plan');
    expect(panel.textContent).toContain('September 2026 as it stands — 2 posts');
    const items = within(panel).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('8 Sep');
    expect(items[0]).toContain('Launch build-up');
    expect(items[1]).toContain('20 Sep');
    expect(items[1]).toContain('Sunday Style');
  });

  /** The receipt line reads "your brief is BELOW", which is only true because of the seed.
   *  With no seed it would be a lie, so it does not render. */
  it('drops the "your brief is below" receipt, which the empty composer would contradict', () => {
    renderWizard({ draftMonth: true, currentBeats: BEATS });
    expect(screen.queryByTestId('intake-brief-receipt')).toBeNull();
    renderWizard({ draftMonth: false });
    expect(screen.getByTestId('intake-brief-receipt')).toBeTruthy();
  });

  it('names what is happening — changing a month, not planning a blank one', () => {
    renderWizard({ draftMonth: true, currentBeats: BEATS });
    expect(screen.getByText('Change September 2026')).toBeTruthy();
    expect(screen.getByTestId('intake-create').textContent).toBe('Update the month');
  });

  it('CLOSES when the brief reshaped the month — the month behind it is the receipt', async () => {
    const { onSubmit, onClose } = renderWizard({ draftMonth: true, currentBeats: BEATS });
    fireEvent.change(screen.getByTestId('intake-input'), { target: { value: 'move the launch to the 12th' } });
    await act(async () => { fireEvent.click(screen.getByTestId('intake-create')); });
    expect(onSubmit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT close when nothing was reshaped — the summary panel is still the answer there', async () => {
    const onSubmit = vi.fn(async (): Promise<IntakeResult> => ({ ok: true, mode: 'brief_updated', draftApplied: false }));
    const onClose = vi.fn();
    render(
      <IntakeCapture
        questions={['Q1']} cycleId="c1" prePlanning busy={false} monthLabel="September 2026"
        intake={{ answers: {}, freeNotes: '' } as unknown as PlanIntake} savedExtraction={null} durable={[]}
        cutoffLabel="18 August" onSubmit={onSubmit} onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByTestId('intake-input'), { target: { value: 'big launch on the 25th' } });
    await act(async () => { fireEvent.click(screen.getByTestId('intake-create')); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('intake-saved-note')).toBeTruthy();
  });
});

/**
 * The structural half, through the REAL root — the surface fork is what used to swallow the
 * wizard, so asserting it against a hand-built tree would test the wrong thing.
 */
describe('PlanRoot mounts the wizard over EITHER surface', () => {
  function init(over: Partial<PlanDataInit> = {}): PlanDataInit {
    return {
      posts: [], crossMonthPosts: [], beats: [],
      cycles: [{ cycleId: 'c1', displayMonth: '2026-09', monthLabel: 'September 2026', prePlanning: true }],
      homeCycleId: 'c1', initialViewedCycleId: 'c1', today: '2026-08-12', clientName: 'ivy-t',
      questions: ['Q1'], intake: { answers: {}, freeNotes: 'A launch on the 8th.' }, savedExtraction: null,
      durable: [], cutoffDay: 18,
      ...over,
    } as unknown as PlanDataInit;
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response));
    // PlanRoot forks on viewport before it forks on surface; jsdom has no matchMedia. `false`
    // is the phone branch, which is the one the draft return sits in.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    window.sessionStorage.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('opens over a DRAFT month — the case the early return used to swallow', async () => {
    await act(async () => {
      render(<PlanRoot {...init({
        initialSurfaceKind: 'draft',
        initialDraft: { beats: BEATS, pillars: ['Home'], editable: true, receipts: [] },
        initialIntakeOpen: true,
      } as Partial<PlanDataInit>)} />);
    });
    expect(screen.getByTestId('intake-panel')).toBeTruthy();
    // And it is told which month it is over: empty composer, current plan as context.
    expect((screen.getByTestId('intake-input') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('intake-current-plan')).toBeTruthy();
  });

  it('still opens over a COMMITTED month, seeded, exactly as before', async () => {
    await act(async () => {
      render(<PlanRoot {...init({ initialSurfaceKind: 'committed-empty', initialIntakeOpen: true } as Partial<PlanDataInit>)} />);
    });
    expect(screen.getByTestId('intake-panel')).toBeTruthy();
    expect((screen.getByTestId('intake-input') as HTMLTextAreaElement).value).toBe('A launch on the 8th.');
    expect(screen.queryByTestId('intake-current-plan')).toBeNull();
  });
});

describe('the way in, from the draft month', () => {
  const summary = {
    headline: '12 posts across September', stage: 'A direction of travel.',
    sections: [{ key: 'pillars', heading: 'PILLARS', facts: [{ text: 'Home & Space', count: '4' }] }],
  };

  it('offers the bulk route beside the one-sentence one', () => {
    const onBrief = vi.fn();
    render(<DraftMonthSummary summary={summary as never} expanded onToggle={() => {}} onAnswer={() => {}} onShape={() => {}} onBrief={onBrief} />);
    fireEvent.click(screen.getByTestId('summary-brief'));
    expect(onBrief).toHaveBeenCalled();
    expect(screen.getByTestId('summary-shape')).toBeTruthy();   // the sentence route survives
  });

  /** Past the cutoff a brief cannot move this month, and an invitation that can only be
   *  refused is worse than none — the same rule `onShape` already followed. */
  it('offers nothing when the month can no longer be changed', () => {
    render(<DraftMonthSummary summary={summary as never} expanded onToggle={() => {}} onAnswer={() => {}} />);
    expect(screen.queryByTestId('summary-brief')).toBeNull();
    expect(screen.queryByTestId('summary-shape')).toBeNull();
  });
});
