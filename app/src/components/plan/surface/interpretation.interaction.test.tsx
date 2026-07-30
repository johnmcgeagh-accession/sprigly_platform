/**
 * @vitest-environment jsdom
 *
 * interpretation.interaction.test.tsx — consent happens on the interpretation, in place.
 *
 * ── The conversation-sheet form ──────────────────────────────────────────────────────
 *
 * The interpretation is now a TURN of the thread (InterpretationTurn) rather than a phase that
 * replaces the sheet's body: same derivation, same lines, with Apply/Discard inline on the turn
 * and a lifecycle (`open → applying → resolved | discarded`). The composer never unmounts, so
 * the turn never needs to steal focus — announcement is the newest-turn live region's job.
 *
 * ── The derivation rule, which is what most of these tests are about ─────────────────
 *
 * Every line is COMPUTED from the extracted structured intent plus the resolved target. Not the
 * transcript (they know what they said; echoing it asks them to check our hearing), and not
 * model-narrated prose (approving a sentence about a change is not approving the change). A
 * misheard word has to show up as a wrong TITLE, which is checkable at a glance.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { InterpretationTurn, lineFor, shortDate, type InterpretationStatus } from './Interpretation';
import type { InterpretedItem } from '@/lib/agent/types';

afterEach(cleanup);

const change = (over: Partial<Extract<InterpretedItem, { kind: 'change' }>> = {}): InterpretedItem => ({
  kind: 'change', proposalId: 'pr1', action: 'move',
  title: 'Fragrance Note Deep Dive: Summer', fromDate: '2026-08-08', toDate: '2026-08-12',
  ...over,
} as InterpretedItem);

function show(items: InterpretedItem[], over: Partial<React.ComponentProps<typeof InterpretationTurn>> & { status?: InterpretationStatus } = {}) {
  const onApply = vi.fn();
  const onDiscard = vi.fn();
  render(<InterpretationTurn items={items} status={over.status ?? 'open'} onApply={onApply} onDiscard={onDiscard} {...over} />);
  return { onApply, onDiscard };
}

describe('a line is computed, not narrated', () => {
  it('a move names the RESOLVED title and BOTH resolved dates', () => {
    // F3a: the SOURCE date is the resolved answer to a relative reference ("Friday's post"),
    // and this line is where a wrong resolution becomes visible before it applies.
    expect(lineFor(change() as never)).toEqual({
      verb: 'Move', title: 'Fragrance Note Deep Dive: Summer', tail: 'Sat 8 Aug → Wed 12 Aug',
    });
  });

  it('a move with no source date still shows the destination alone', () => {
    expect(lineFor(change({ fromDate: null }) as never)).toEqual({
      verb: 'Move', title: 'Fragrance Note Deep Dive: Summer', tail: '→ Wed 12 Aug',
    });
  });

  it('an add names the format, the subject and the day', () => {
    expect(lineFor(change({ action: 'add', title: 'Atlas Cedar restock', toDate: '2026-09-04', format: 'single', fromDate: null }) as never))
      .toEqual({ verb: 'Add a single image', title: 'Atlas Cedar restock', tail: 'Fri 4 Sep' });
  });

  it('an add with NO stated subject invents nothing', () => {
    const l = lineFor(change({ action: 'add', title: null, toDate: '2026-09-04', format: 'reel', fromDate: null }) as never);
    expect(l).toEqual({ verb: 'Add a reel', title: null, tail: 'Fri 4 Sep' });
  });

  it('every other action reads as an action, with its target resolved', () => {
    expect(lineFor(change({ action: 'remove' }) as never).verb).toBe('Remove');
    expect(lineFor(change({ action: 'rewrite' }) as never).verb).toBe('Rewrite the caption for');
    expect(lineFor(change({ action: 'format', format: 'carousel' }) as never))
      .toEqual({ verb: 'Change', title: 'Fragrance Note Deep Dive: Summer', tail: 'to a carousel' });
    expect(lineFor(change({ action: 'refine', target: 'hook' }) as never).verb).toBe('Refine the hook for');
  });

  it('dates are rendered by the SURFACE from ISO — never a phrase off the wire', () => {
    expect(shortDate('2026-08-12')).toBe('Wed 12 Aug');
    expect(shortDate('2026-01-01')).toBe('Thu 1 Jan');
    expect(shortDate('nonsense')).toBe('nonsense');
  });
});

describe('a two-intent utterance renders two lines', () => {
  const TWO: InterpretedItem[] = [
    change({ proposalId: 'pr1', action: 'move', title: 'Fragrance Note Deep Dive: Summer', toDate: '2026-08-12' }),
    change({ proposalId: 'pr2', action: 'add', title: 'Atlas Cedar restock', toDate: '2026-09-04', format: 'single', fromDate: null }),
  ];

  it('both, with their own titles and their own dates', () => {
    show(TWO);
    const rows = screen.getAllByTestId('interp-change');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Fragrance Note Deep Dive: Summer');
    expect(rows[0]!.textContent).toContain('Wed 12 Aug');
    expect(rows[1]!.textContent).toContain('Atlas Cedar restock');
    expect(rows[1]!.textContent).toContain('Fri 4 Sep');
  });

  it('Apply names how many, and fires once', () => {
    const { onApply } = show(TWO);
    expect(screen.getByTestId('interp-apply').textContent).toBe('Apply these 2 changes');
    fireEvent.click(screen.getByTestId('interp-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('one change reads as one', () => {
    show([TWO[0]!]);
    expect(screen.getByTestId('interp-apply').textContent).toBe('Apply this change');
  });

  it('a line can be left out on its own — while the turn is still open', () => {
    const onDropItem = vi.fn();
    show(TWO, { onDropItem });
    fireEvent.click(screen.getAllByTestId('interp-drop')[1]!);
    expect(onDropItem).toHaveBeenCalledWith('pr2');
  });

  it('a RESOLVED turn offers nothing to press — a receipt does not need a second Apply', () => {
    show(TWO, { status: 'resolved', onDropItem: vi.fn() });
    expect(screen.queryByTestId('interp-apply')).toBeNull();
    expect(screen.queryByTestId('interp-discard')).toBeNull();
    expect(screen.queryByTestId('interp-drop')).toBeNull();
    // The lines themselves stay — the thread's record of what was agreed.
    expect(screen.getAllByTestId('interp-change')).toHaveLength(2);
  });
});

describe('what could not be resolved says so, and applies nothing', () => {
  it('an unplaceable idea renders the honest fallback the intake receipts use', () => {
    show([{ kind: 'idea', text: 'the candle relaunch is coming' }]);
    const said = screen.getByTestId('interp-idea').textContent ?? '';
    expect(said).toContain('Saved to your ideas');
    expect(said).toContain('couldn’t place a date');
  });

  it('APPLY IS ABSENT when nothing is applicable — and so is Discard, because there is nothing to reject', () => {
    // The old full-sheet phase kept Discard as the way out; in a thread the way out is the
    // composer beneath, which never unmounts. Buttons on a turn with no proposals would be
    // controls that can only refuse.
    show([{ kind: 'idea', text: 'something' }, { kind: 'unresolved', question: 'Which post did you mean?' }]);
    expect(screen.queryByTestId('interp-apply')).toBeNull();
    expect(screen.queryByTestId('interp-discard')).toBeNull();
  });

  it('a misheard reference renders its real question, not a shrug', () => {
    show([{ kind: 'unresolved', question: 'I couldn’t tell which post you meant. Could you name its date?' }]);
    expect(screen.getByTestId('interp-unresolved').textContent).toContain('name its date');
  });

  it('MIXED: what landed is applicable, what did not is stated beside it', () => {
    show([
      change({ proposalId: 'pr1' }),
      { kind: 'unresolved', question: 'I couldn’t tell which post you meant for “the other one”.' },
    ]);
    expect(screen.getByTestId('interp-change')).toBeTruthy();
    expect(screen.getByTestId('interp-unresolved')).toBeTruthy();
    expect(screen.getByTestId('interp-apply').textContent).toBe('Apply this change');
  });

  it('nothing at all is said plainly rather than left blank', () => {
    show([]);
    expect(screen.getByTestId('interp-empty').textContent).toContain('didn’t catch anything to change');
    expect(screen.queryByTestId('interp-apply')).toBeNull();
  });
});

describe('the register, the lifecycle, and the words', () => {
  it('is the agent’s block — the same tint field and accent edge as everywhere else it speaks', () => {
    show([change()]);
    const block = screen.getByTestId('interpretation');
    expect(block.className).toContain('bg-coral-100');
    expect(block.className).toContain('border-coral-700');
  });

  it('says APPLY, never approve', () => {
    show([change()]);
    expect(screen.getByTestId('interpretation').textContent).not.toMatch(/approv/i);
    expect(screen.getByTestId('interp-apply').textContent).toMatch(/^Apply/);
  });

  it('APPLYING shows the one working indicator and nothing to press', () => {
    show([change()], { status: 'applying' });
    expect(screen.getByTestId('agent-dots')).toBeTruthy();
    expect(screen.queryByTestId('interp-apply')).toBeNull();
    expect(screen.queryByTestId('interp-discard')).toBeNull();
  });

  it('DISCARDED says so on the turn — the thread keeps its history honest', () => {
    show([change()], { status: 'discarded' });
    expect(screen.getByTestId('interp-discarded').textContent).toContain('nothing changed');
    expect(screen.queryByTestId('interp-apply')).toBeNull();
  });

  it('is a live region ONLY when it is the newest turn', () => {
    show([change()], { live: true });
    expect(screen.getByTestId('interpretation').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('interpretation').getAttribute('aria-live')).toBe('polite');
    cleanup();
    show([change()]);
    expect(screen.getByTestId('interpretation').getAttribute('role')).toBeNull();
    expect(screen.getByTestId('interpretation').getAttribute('aria-live')).toBeNull();
  });

  it('does NOT steal focus — the composer is still where the client is standing', () => {
    show([change()]);
    expect(document.activeElement).toBe(document.body);
  });

  it('everything is inert while a write is in flight', () => {
    show([change()], { busy: true, onDropItem: vi.fn() });
    expect((screen.getByTestId('interp-apply') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('interp-discard') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('interp-drop') as HTMLButtonElement).disabled).toBe(true);
  });

  it('nothing here echoes the transcript back', () => {
    const item = change() as Record<string, unknown>;
    expect(Object.keys(item)).not.toContain('transcript');
    expect(Object.keys(item)).not.toContain('reason');
    expect(Object.keys(item)).not.toContain('said');
  });
});
