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

/** The session opener: POST /api/plan/conversation answers with a fresh conversation id. */
function stubHistory(conversationId: string | null = 'conv-1') {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ conversationId, turns: [] }) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sheet(over: Partial<React.ComponentProps<typeof VoiceSheet>> = {}) {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
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
  return { onSubmit, onApply, onDiscard, onClose, fetchMock };
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
    // The session's conversation rides with the apply: the settled report is written back
    // as a turn, which is what makes the rescue it may offer resolvable (G1/G3).
    expect(onApply).toHaveBeenCalledWith(['pr1'], [MOVE_ITEM], expect.anything());
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
    expect(onSubmit).toHaveBeenLastCalledWith('the one called A', 'web', 'conv-1', []);
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

/**
 * ── C3: the pending change is the referent ───────────────────────────────────────────
 *
 * While an interpretation is unapplied it is what the client is looking at, so a correction
 * amends it. The old turn is marked superseded — visible, because the thread is the record,
 * and not applicable, because two versions of one change must never both be.
 */
describe('a correction AMENDS the pending change', () => {
  const REEL_ITEM: InterpretedItem = {
    kind: 'change', proposalId: 'pr2', action: 'add',
    title: 'Atlas Cedar restock', toDate: '2026-08-21', format: 'reel',
  };
  const ADD_ITEM: InterpretedItem = {
    kind: 'change', proposalId: 'pr1', action: 'add',
    title: 'Atlas Cedar restock', toDate: '2026-08-21', format: 'single',
  };

  it('sends the OPEN turn’s proposals as the referent, and marks it superseded when they are amended', async () => {
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ ok: true, items: [ADD_ITEM] })
      .mockResolvedValueOnce({ ok: true, items: [REEL_ITEM], supersededProposalIds: ['pr1'] });
    sheet({ onSubmit });
    await screen.findByTestId('turn-agent');

    await send('add something for the restock');
    // The first ask carried nothing pending — there was nothing on screen yet.
    expect(onSubmit).toHaveBeenNthCalledWith(1, 'add something for the restock', 'web', 'conv-1', []);

    await send('instead of a single image make it a reel');
    // The second carried the open interpretation's proposal — the referent.
    expect(onSubmit).toHaveBeenNthCalledWith(2, 'instead of a single image make it a reel', 'web', 'conv-1', ['pr1']);

    const turns = screen.getAllByTestId('interpretation');
    expect(turns).toHaveLength(2);
    // The old one is SUPERSEDED: still readable, no longer applicable.
    expect(turns[0]!.getAttribute('data-status')).toBe('superseded');
    expect(turns[0]!.textContent).toContain('Atlas Cedar restock');
    expect(within(turns[0]!).getByTestId('interp-superseded').textContent).toContain('Replaced by what you said next');
    expect(within(turns[0]!).queryByTestId('interp-apply')).toBeNull();
    // The new one is the only thing to apply.
    expect(turns[1]!.getAttribute('data-status')).toBe('open');
    expect(within(turns[1]!).getByTestId('interp-apply')).toBeTruthy();
    expect(screen.getAllByTestId('interp-apply')).toHaveLength(1);
  });

  it('an UNRELATED ask supersedes nothing — both turns stay applicable', async () => {
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ ok: true, items: [ADD_ITEM] })
      .mockResolvedValueOnce({ ok: true, items: [MOVE_ITEM] });   // no supersededProposalIds
    sheet({ onSubmit });
    await screen.findByTestId('turn-agent');

    await send('add something for the restock');
    await send('also move the Friday post');

    const turns = screen.getAllByTestId('interpretation');
    expect(turns.map((t) => t.getAttribute('data-status'))).toEqual(['open', 'open']);
    expect(screen.getAllByTestId('interp-apply')).toHaveLength(2);
  });

  it('a RESOLVED turn is not offered as a referent — it is already applied', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, items: [MOVE_ITEM] }));
    sheet({ onSubmit });
    await screen.findByTestId('turn-agent');
    await send('move it');
    await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });

    await send('make it a reel');
    expect(onSubmit).toHaveBeenLastCalledWith('make it a reel', 'web', 'conv-1', []);
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
    expect(onApply).toHaveBeenCalledWith(['pr2'], expect.anything(), expect.anything());
  });
});

/**
 * ── PER SESSION, not per month (operator ruling, round 2) ────────────────────────────
 *
 * Round 1 made the thread per-cycle and everlasting: reopening showed every exchange the month
 * had ever had, and the parser's context window was that same list. Each open is now its own
 * conversation — the framing speaks first into an empty sheet, and the prior ones stay stored
 * without being rendered.
 */
describe('each open is a fresh session', () => {
  it('opens a conversation and shows ONLY the framing turn — no month history', async () => {
    const { fetchMock } = sheet();
    const framing = await screen.findByTestId('turn-agent');
    expect(framing.textContent).toContain('October is written');
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0);
    expect(screen.queryByTestId('interpretation')).toBeNull();

    // It STARTS one rather than asking what the month has said before.
    const opened = fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/api/plan/conversation'));
    expect(opened, 'the sheet opens a session').toBeTruthy();
    expect((opened![1] as RequestInit | undefined)?.method).toBe('POST');
  });

  it('the framing lands IMMEDIATELY — a sheet that waits on the network opens blank', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));   // never settles
    sheet();
    expect(screen.getByTestId('turn-agent').textContent).toContain('October is written');
    expect(screen.getByTestId('voice-input')).toBeTruthy();
  });

  it('carries THIS session’s conversation on every turn — the context window is the session', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const, items: [MOVE_ITEM], conversationId: 'conv-session-1' }));
    sheet({ onSubmit });
    await screen.findByTestId('turn-agent');

    await send('move it');
    // The first turn carries whatever the open-time POST returned…
    expect(onSubmit).toHaveBeenLastCalledWith('move it', 'web', 'conv-1', []);
    await send('and make it a carousel');
    // …and every turn after it carries the conversation the server confirmed.
    // …and the open interpretation from the first turn rides along as the referent (C3).
    expect(onSubmit).toHaveBeenLastCalledWith('and make it a carousel', 'web', 'conv-session-1', ['pr1']);
  });

  it('REOPENING is a clean sheet — the previous session is stored, not rendered', async () => {
    sheet();
    await screen.findByTestId('turn-agent');
    await send('move it');
    expect(screen.getByTestId('turn-user')).toBeTruthy();
    cleanup();

    stubHistory();
    sheet();
    await screen.findByTestId('turn-agent');
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0);
    expect(screen.queryByTestId('interpretation')).toBeNull();
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

  it('ONLY the newest agent turn is a live region — a thread must not re-announce itself', async () => {
    sheet({ onSubmit: vi.fn(async () => ({ ok: true as const, items: [], message: 'One reel — the Weekend Style Guide.' })) });
    await screen.findByTestId('turn-agent');
    await send('what’s planned on Friday?');

    const agents = screen.getAllByTestId('turn-agent');
    expect(agents).toHaveLength(2);                                // the framing, then the answer
    expect(agents[0]!.getAttribute('aria-live')).toBeNull();
    expect(agents[1]!.getAttribute('aria-live')).toBe('polite');
    expect(agents[1]!.getAttribute('aria-atomic')).toBe('true');   // a reply arrives whole
  });

  it('axe finds nothing on the thread', async () => {
    sheet();
    await screen.findByTestId('turn-agent');
    await send('move it');
    await screen.findByTestId('interpretation');
    const results = await axe.run(screen.getByTestId('thread'), {
      // jsdom has no layout engine, so colour-contrast (canvas-based) cannot run here; the
      // pairings are checked by the spec's own contrast table instead.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(', ')}`)).toEqual([]);
  });
});
