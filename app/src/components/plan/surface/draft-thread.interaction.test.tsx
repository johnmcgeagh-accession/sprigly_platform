/**
 * @vitest-environment jsdom
 *
 * draft-thread.interaction.test.tsx — the draft dock's conversation is ONE conversation.
 *
 * The defect this pins: every turn on a draft month opened a new conversation, so no two
 * turns ever shared a thread and a correction had no previous turn to resolve against.
 * Measured on cycle 5ea00045 before the fix — 45 conversation rows for 16 exchanges.
 *
 * The cause was a discarded argument, not a missing one. `VoiceSheet` has always passed the
 * session's conversation id as `onSubmit`'s third parameter and `CommittedSurface` has always
 * threaded it; the two `DraftSurface` mounts declared `(text, source)` and dropped it, and the
 * route then called `ensureConversation` with two arguments — which since the per-session
 * ruling means "start a new one".
 *
 * So these tests watch the ARGUMENT and the ECHO, at the seam where it was lost: what the
 * sheet hands the caller, and what the caller hands back. The route's half is covered by
 * apply-conversation.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { VoiceSheet } from './VoiceSheet';

type Submit = React.ComponentProps<typeof VoiceSheet>['onSubmit'];
/** A submit spy that keeps the prop's own four-parameter signature — the third argument IS the
 *  subject of this file, so a spy that erases it would pass while proving nothing. */
const submitSpy = (result: Awaited<ReturnType<Submit>>) =>
  vi.fn<Parameters<Submit>, ReturnType<Submit>>(async () => result);

const composer = () => screen.getByTestId('voice-input') as HTMLTextAreaElement;
const send = () => screen.getByTestId('voice-submit');

/** Type a sentence and send it, settling the async submit. */
async function say(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => { fireEvent.click(send()); });
}

/** The open-time POST that mints a session id, and nothing else. */
function serverMints(id: string | null) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ conversationId: id, turns: [] }) })));
}

beforeEach(() => {
  window.sessionStorage.clear();
  serverMints('conv-1');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the draft dock threads one conversation across consecutive turns', () => {
  it('sends the SAME conversation id on the second turn as the first', async () => {
    const onSubmit = submitSpy({ ok: true as const, message: 'done' });
    render(<VoiceSheet open monthName="November" cycleId="cyc-nov" busy={false}
      chrome="panel" entry="docked" onClose={() => {}} onSubmit={onSubmit} />);
    // Let the open-time POST settle so the sheet is holding the minted id.
    await act(async () => { await Promise.resolve(); });

    await say('move a post from the 17th to the week before');
    await say('I only wanted one of those moving');

    expect(onSubmit).toHaveBeenCalledTimes(2);
    // The third argument is the conversation. Both turns carry it, and it is the same one.
    expect(onSubmit.mock.calls[0]![2]).toBe('conv-1');
    expect(onSubmit.mock.calls[1]![2]).toBe('conv-1');
  });

  it('adopts the id the SERVER echoes when the open-time POST never answered', async () => {
    // The open POST fails: the sheet has no id, so the first turn sends null and the server
    // opens the conversation. Its echo is what the rest of the session must land in.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const onSubmit = submitSpy({ ok: true as const, message: 'done', conversationId: 'conv-server' });
    render(<VoiceSheet open monthName="November" cycleId="cyc-nov" busy={false}
      chrome="panel" entry="docked" onClose={() => {}} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });

    await say('move a post from the 17th to the week before');
    await say('I only wanted one of those moving');

    expect(onSubmit.mock.calls[0]![2]).toBeNull();
    expect(onSubmit.mock.calls[1]![2]).toBe('conv-server');
  });

  it('sends null on the FIRST turn of a session — there is no thread yet', async () => {
    serverMints(null);
    const onSubmit = submitSpy({ ok: true as const, message: 'done' });
    render(<VoiceSheet open monthName="November" cycleId="cyc-nov" busy={false}
      chrome="panel" entry="docked" onClose={() => {}} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });

    await say('what is on next week');

    expect(onSubmit.mock.calls[0]![2]).toBeNull();
  });
});

/**
 * ── A MONTH SWITCH ENDS THE SESSION ──────────────────────────────────────────────────
 *
 * The dock's `open` prop is a bare literal and never toggles, so the reset that hangs off the
 * open transition never fired there: the thread stayed on screen across a month switch while
 * the held id went on pointing at the month the client had left. Threads are per-month, so
 * both halves move together — the turns clear, and the next sentence opens a fresh
 * conversation on the cycle actually on screen.
 */
describe('a month switch clears the dock and starts a new conversation', () => {
  it('empties the thread and drops the held id when the cycle changes', async () => {
    const onSubmit = submitSpy({ ok: true as const, message: 'done' });
    const view = render(<VoiceSheet open monthName="November" cycleId="cyc-nov" busy={false}
      chrome="panel" entry="docked" onClose={() => {}} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });

    await say('move a post from the 17th to the week before');
    expect(screen.getAllByTestId('turn-user')).toHaveLength(1);

    // The client switches month. The dock is the same mounted region throughout.
    serverMints('conv-2');
    view.rerender(<VoiceSheet open monthName="December" cycleId="cyc-dec" busy={false}
      chrome="panel" entry="docked" onClose={() => {}} onSubmit={onSubmit} />);
    await act(async () => { await Promise.resolve(); });

    // The history is GONE from the screen, not merely unreadable by the parser — the client
    // must be able to see that "no, the other one" has nothing left to refer to.
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0);

    await say('move a post from the 3rd to the 5th');
    // A fresh conversation on the new cycle, never November's.
    expect(onSubmit.mock.calls[1]![2]).toBe('conv-2');
  });
});
