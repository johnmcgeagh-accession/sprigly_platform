/**
 * @vitest-environment jsdom
 *
 * conversation-sheet.interaction.test.tsx — the thread, driven end to end.
 *
 * The sheet is one thread and one composer: client turns as right bubbles, agent turns in the
 * AgentVoice register born as dots and filling as they resolve, interpretation turns carrying
 * their own Apply/Discard. The dead-end is gone by construction — the composer never unmounts —
 * and these tests walk the flows that prove it: speak → interpretation → apply-in-thread →
 * confirmation turn; question → answer-in-composer → resolution; discard leaves the plan alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import axe from 'axe-core';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet } from './VoiceSheet';
import type { InterpretedItem } from '@/lib/agent/types';

const MOVE_ITEM: InterpretedItem = {
  kind: 'change', proposalId: 'pr1', action: 'move',
  title: 'Fragrance Note Deep Dive: Summer', fromDate: '2026-10-08', toDate: '2026-10-12',
};

function stubHistory(turns: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ conversationId: turns.length ? 'conv-1' : null, turns }),
  })));
}

function sheet(over: Partial<React.ComponentProps<typeof VoiceSheet>> = {}) {
  const onSubmit = over.onSubmit ?? vi.fn(async () => ({ ok: true as const, items: [MOVE_ITEM] }));
  const onApply = over.onApply ?? vi.fn(async () => ({ text: 'Done — your plan is updated.' }));
  const onDiscard = over.onDiscard ?? vi.fn();
  const onClose = vi.fn();
  render(
    <VoiceSheet
      open monthName="October" cycleId="cyc-1" busy={false} context="committed" entry="type"
      onClose={onClose} {...over}
      onSubmit={onSubmit} onApply={onApply} onDiscard={onDiscard}
    />,
  );
  return { onSubmit, onApply, onDiscard, onClose };
}

const composer = () => screen.getByTestId('voice-input') as HTMLTextAreaElement;
const send = async (text: string) => {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
};

beforeEach(() => { window.sessionStorage.clear(); stubHistory(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the empty state is one agent turn + the composer', () => {
  it('the framing is the agent’s FIRST TURN, not chrome', async () => {
    sheet();
    const first = await screen.findByTestId('turn-agent');
    expect(first.textContent).toContain('October is written');
    expect(screen.getByTestId('voice-input')).toBeTruthy();
    // No secondary status bars: nothing else claims to be thinking or listening.
    expect(screen.queryByTestId('voice-framing')).toBeNull();
  });

  it('a nudge question arrives as an agent turn — a question IN the conversation', async () => {
    sheet({ question: 'We’ve assumed nothing’s launching — anything coming up?' });
    const agents = await screen.findAllByTestId('turn-agent');
    expect(agents[agents.length - 1]!.textContent).toContain('anything coming up?');
  });
});

describe('speak → interpretation → apply-in-thread → confirmation turn', () => {
  it('the client’s words land as a right bubble, the agent turn is born working and FILLS', async () => {
    let settle!: (v: { ok: true; items: InterpretedItem[] }) => void;
    const onSubmit = vi.fn(() => new Promise<never>((res) => { settle = res as never; }) as never);
    sheet({ onSubmit: onSubmit as never });
    await screen.findByTestId('turn-agent');

    fireEvent.change(composer(), { target: { value: 'move it to the 12th' } });
    fireEvent.click(screen.getByTestId('voice-submit'));

    // The transcript bubble is up NOW, and the agent's turn is dots — never an empty panel.
    expect(screen.getByTestId('turn-user').textContent).toBe('move it to the 12th');
    const working = screen.getAllByTestId('turn-agent').pop()!;
    expect(within(working).getByTestId('agent-dots')).toBeTruthy();

    await act(async () => { settle({ ok: true, items: [MOVE_ITEM] }); });
    // Dots → content: the same turn resolves into the interpretation.
    const interp = screen.getByTestId('interpretation');
    expect(interp.getAttribute('data-status')).toBe('open');
    expect(interp.textContent).toContain('Fragrance Note Deep Dive: Summer');
    expect(interp.textContent).toContain('Thu 8 Oct → Mon 12 Oct');
  });

  it('APPLY runs on the turn: dots while applying, then the confirmation as the NEXT agent turn — and the sheet stays', async () => {
    let settleApply!: (v: { text: string }) => void;
    const onApply = vi.fn(() => new Promise<{ text: string }>((res) => { settleApply = res; }));
    const { onSubmit } = sheet({ onApply });
    await screen.findByTestId('turn-agent');
    await send('move it to the 12th');
    expect(onSubmit).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('interp-apply'));
    expect(onApply).toHaveBeenCalledWith(['pr1'], [MOVE_ITEM]);
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('applying');
    // The one working indicator is the turn's dots — no Apply button left to press twice.
    expect(screen.queryByTestId('interp-apply')).toBeNull();

    await act(async () => { settleApply({ text: 'Done — your plan is updated.' }); });
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('resolved');
    const agents = screen.getAllByTestId('turn-agent');
    expect(agents[agents.length - 1]!.textContent).toContain('Done — your plan is updated.');
    // The sheet did not close; the conversation continues.
    expect(screen.getByTestId('voice-sheet')).toBeTruthy();
    expect(screen.getByTestId('voice-input')).toBeTruthy();
  });

  it('a failure report becomes the confirmation turn too — named, in the thread', async () => {
    sheet({ onApply: vi.fn(async () => ({ text: 'That didn’t go through: Move “Fragrance Note Deep Dive: Summer”. It’s still here to try again.' })) });
    await screen.findByTestId('turn-agent');
    await send('move it');
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    const agents = screen.getAllByTestId('turn-agent');
    expect(agents[agents.length - 1]!.textContent).toContain('still here to try again');
  });
});

describe('question → answer-in-composer → resolution: the dead-end is gone', () => {
  it('an agent question is just a turn, and the composer answers it', async () => {
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ ok: true, items: [{ kind: 'unresolved', question: 'There are 2 posts on 14 August — “A” or “B”? Which one did you mean?' }] })
      .mockResolvedValueOnce({ ok: true, items: [MOVE_ITEM] });
    sheet({ onSubmit });
    await screen.findByTestId('turn-agent');

    await send('move the Friday post');
    // The question renders on the interpretation turn — with NO Apply, because nothing applies.
    expect(screen.getByTestId('interp-unresolved').textContent).toContain('Which one did you mean');
    expect(screen.queryByTestId('interp-apply')).toBeNull();

    // …and the composer is still there to answer with. No phase to escape from.
    await send('the one called A');
    expect(onSubmit).toHaveBeenLastCalledWith('the one called A', 'web');
    expect(screen.getByTestId('interp-apply')).toBeTruthy();   // the follow-up resolved
  });

  it('a query’s answer is an agent turn with structure — lines, not asterisks', async () => {
    sheet({
      onSubmit: vi.fn(async () => ({
        ok: true, items: [],
        message: '**Friday 14 August:**\n* Reel — Weekend Style Guide\n* Single — The restock',
      })),
    });
    await screen.findByTestId('turn-agent');
    await send('what’s planned on Friday?');
    const last = screen.getAllByTestId('turn-agent').pop()!;
    expect(last.textContent).not.toContain('*');
    expect(within(last).getAllByTestId('turn-line')).toHaveLength(3);
  });
});

describe('discard leaves the plan byte-identical', () => {
  it('DISCARD rejects the turn’s proposals, marks the turn, applies nothing — and the thread continues', async () => {
    const { onApply, onDiscard } = sheet();
    await screen.findByTestId('turn-agent');
    await send('move it');

    fireEvent.click(screen.getByTestId('interp-discard'));
    expect(onDiscard).toHaveBeenCalledWith(['pr1']);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('discarded');
    expect(screen.getByTestId('interp-discarded').textContent).toContain('nothing changed');
    expect(screen.getByTestId('voice-input')).toBeTruthy();
  });

  it('a per-item × rejects just that row and the rest stays applicable', async () => {
    const TWO = [MOVE_ITEM, { ...MOVE_ITEM, proposalId: 'pr2', title: 'The other one' } as InterpretedItem];
    const { onDiscard, onApply } = sheet({ onSubmit: vi.fn(async () => ({ ok: true as const, items: TWO })) });
    await screen.findByTestId('turn-agent');
    await send('move both');

    fireEvent.click(screen.getAllByTestId('interp-drop')[0]!);
    expect(onDiscard).toHaveBeenCalledWith(['pr1']);
    expect(screen.getByTestId('interpretation').getAttribute('data-status')).toBe('open');

    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
    expect(onApply).toHaveBeenCalledWith(['pr2'], expect.anything());
  });
});

describe('the thread survives a reopen (persisted history)', () => {
  const HISTORY = [
    { id: 'm1', role: 'user', content: 'move the post on the 3rd to the 8th', source: 'voice', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'm2', role: 'assistant', content: '', source: 'web', createdAt: '2026-10-01T10:00:05Z', items: [MOVE_ITEM], proposalIds: ['pr1'] },
    { id: 'm3', role: 'user', content: 'what’s planned on Friday?', source: 'web', createdAt: '2026-10-01T10:01:00Z' },
    { id: 'm4', role: 'assistant', content: 'One reel — the Weekend Style Guide.', source: 'web', createdAt: '2026-10-01T10:01:05Z' },
  ];

  it('reopening renders the same turns — bubbles, interpretation, answer', async () => {
    stubHistory(HISTORY);
    sheet({ isPending: () => true });
    await screen.findByTestId('interpretation');
    expect(screen.getAllByTestId('turn-user')).toHaveLength(2);
    expect(screen.getByTestId('interpretation').textContent).toContain('Fragrance Note Deep Dive: Summer');
    expect(screen.getAllByTestId('turn-agent').pop()!.textContent).toContain('Weekend Style Guide');
  });

  it('a reopened interpretation is actionable ONLY while its proposals are pending', async () => {
    stubHistory(HISTORY);
    sheet({ isPending: () => true });
    expect((await screen.findByTestId('interpretation')).getAttribute('data-status')).toBe('open');
    expect(screen.getByTestId('interp-apply')).toBeTruthy();
    cleanup();

    stubHistory(HISTORY);
    sheet({ isPending: () => false });
    expect((await screen.findByTestId('interpretation')).getAttribute('data-status')).toBe('resolved');
    expect(screen.queryByTestId('interp-apply')).toBeNull();
  });

  it('the framing turn does NOT render over a real history', async () => {
    stubHistory(HISTORY);
    sheet({ isPending: () => false });
    await screen.findByTestId('interpretation');
    expect(screen.getByTestId('thread').textContent).not.toContain('October is written');
  });
});

describe('narrow, motion, and the announcement contract', () => {
  it('renders and stays operable at 375px and 320px', async () => {
    for (const width of [375, 320]) {
      window.innerWidth = width;
      stubHistory();
      sheet();
      await screen.findByTestId('turn-agent');
      await send('move it');
      expect(screen.getByTestId('interpretation')).toBeTruthy();
      expect(screen.getByTestId('voice-mic')).toBeTruthy();
      expect(screen.getByTestId('voice-submit')).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('the working dots hold a static state under reduced motion — motion-safe only', async () => {
    sheet();
    await screen.findByTestId('turn-agent');
    fireEvent.change(composer(), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('voice-submit'));
    for (const dot of screen.getByTestId('agent-dots').children) {
      expect((dot as HTMLElement).className).toContain('motion-safe:animate-dot-pulse');
    }
  });

  it('ONLY the newest agent turn is a live region — a history must not re-announce itself', async () => {
    stubHistory([
      { id: 'm1', role: 'assistant', content: 'First answer.', source: 'web', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Second answer.', source: 'web', createdAt: '2026-10-01T10:01:00Z' },
    ]);
    sheet();
    const agents = await screen.findAllByTestId('turn-agent');
    expect(agents[0]!.getAttribute('aria-live')).toBeNull();
    expect(agents[1]!.getAttribute('aria-live')).toBe('polite');
    expect(agents[1]!.getAttribute('aria-atomic')).toBe('true');   // a reply arrives whole
  });

  it('axe finds nothing on the thread', async () => {
    stubHistory([
      { id: 'm1', role: 'user', content: 'move it', source: 'voice', createdAt: '2026-10-01T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: '', source: 'web', createdAt: '2026-10-01T10:00:05Z', items: [MOVE_ITEM], proposalIds: ['pr1'] },
    ]);
    sheet({ isPending: () => true });
    await screen.findByTestId('interpretation');
    const results = await axe.run(screen.getByTestId('thread'), {
      // jsdom has no layout engine, so colour-contrast (canvas-based) cannot run here; the
      // pairings are checked by the spec's own contrast table instead.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(', ')}`)).toEqual([]);
  });
});
