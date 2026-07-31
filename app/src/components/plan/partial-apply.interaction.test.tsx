/**
 * @vitest-environment jsdom
 *
 * partial-apply.interaction.test.tsx — THE VANISHED LAUNCH POST (G3).
 *
 * The October report: a launch arc was asked for, applied, and confirmed — and one of its posts
 * was never on the calendar. The teasers went in. The launch post did not. Nothing on the screen
 * said so, in the thread or out of it.
 *
 * ── Why F4's failure-naming never fired ──────────────────────────────────────────────
 *
 * `applyFailureMessage` has named what didn't apply since F4, and it is only ever called when
 * `applyChanges` reports a non-empty `failed`. It never did. A guard refusal in
 * `approveProposal` is not an HTTP error — it writes the reason to the proposal row, sets the
 * status to 'failed', and returns 200 with an ordinary body. `usePlanData.decide` read
 * `res.ok`, saw a 200, and returned `{ ok: true }`. The refusal went into the APPLIED list.
 *
 * So every layer above it was working from a false premise: `failed` was empty, the failure
 * sentence was never composed, the chip counted the refused item among the successes, and the
 * confirmation turn read "Done — 3 changes are in" over a plan holding two.
 *
 * This harness drives the REAL stack — `PlanRoot`, the real `usePlanData`, the real surface —
 * with only the network faked, because the bug lives in the seam between the route's response
 * and the hook that reads it, and no fixture built on a hand-made `PlanData` can see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { PlanRoot } from './PlanRoot';
import { navTraceClear } from './nav-trace';
import { resetNavSnapshot } from './nav-state';
import type { PlanDataInit } from './usePlanData';
import type { PlanPost } from '@/lib/types';

const TODAY = '2026-10-20';
const OCT = 'cyc-oct';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p-oct-22', cycleId: OCT, clientId: 'c1', channel: 'instagram',
  date: '2026-10-22', format: 'reel', pillar: 'Style',
  caption: 'The layers edit', status: 'planned', reviewState: null, steps: [], postingTime: '07:00',
  ...over,
});

const OCT_POSTS = [post()];

function init(): PlanDataInit {
  return {
    posts: OCT_POSTS, crossMonthPosts: [], beats: [],
    cycles: [{ cycleId: OCT, displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }] as PlanDataInit['cycles'],
    homeCycleId: OCT,
    initialViewedCycleId: OCT,
    today: TODAY,
    clientName: 'earl-of-east',
    questions: [],
    intake: { answers: {}, freeNotes: '' },
    durable: [],
  } as PlanDataInit;
}

/**
 * THE ARC, as the agent raised it: two teasers and the launch post itself. Three proposals,
 * one changeSet, applied sequentially — which is load-bearing and is exactly the shape the
 * October failure took.
 */
const ARC = {
  conversationId: 'conv-1', message: '',
  proposals: [
    { id: 'pr-tease-1', intent: 'add_post', summary: 's1', status: 'pending', changeSetId: 'cs1' },
    { id: 'pr-launch',  intent: 'add_post', summary: 's2', status: 'pending', changeSetId: 'cs1' },
    { id: 'pr-tease-2', intent: 'add_post', summary: 's3', status: 'pending', changeSetId: 'cs1' },
  ],
  items: [
    { kind: 'change', proposalId: 'pr-tease-1', action: 'add', title: 'Teaser one', toDate: '2026-10-26', format: 'reel' },
    { kind: 'change', proposalId: 'pr-launch',  action: 'add', title: 'Launch day', toDate: '2026-10-31', format: 'reel' },
    { kind: 'change', proposalId: 'pr-tease-2', action: 'add', title: 'Teaser two', toDate: '2026-10-29', format: 'reel' },
  ],
  changeSetId: 'cs1',
};

/** The refusal the route really sends: HTTP 200, a failed proposal, and (now) the reason. */
type Refusal = { failed?: boolean; message?: string; status?: string };

function stubNetwork(refuse: Record<string, Refusal> = {}) {
  const approves: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (u.startsWith('/api/plan/proposals')) {
      const m = /\/proposals\/([^/]+)\/approve$/.exec(u);
      if (m) {
        const id = m[1]!;
        approves.push(id);
        const r = refuse[id];
        if (r) {
          return json({
            proposal: { id, status: r.status ?? 'failed' },
            ...(r.failed ? { failed: true } : {}),
            ...(r.message ? { message: r.message } : {}),
          });
        }
        return json({ proposal: { id, status: 'applied' }, changedPostIds: [`post-of-${id}`] });
      }
      if (u.endsWith('/reject')) return json({ proposal: { id: 'x', status: 'rejected' } });
      return json({ proposals: [] });
    }
    if (u.startsWith('/api/plan/conversation')) return json({ conversationId: null, turns: [] });
    if (u.startsWith('/api/plan/changes')) return json({ changes: [] });
    if (u.startsWith('/api/plan/notes')) return json({ notes: [] });
    if (u.startsWith('/api/plan/weather')) return json({ forecast: [] });
    if (u.startsWith('/api/plan/events')) return json({});
    if (u.startsWith('/api/plan/agent')) return json(ARC);
    if (u.startsWith('/api/plan')) return json({ posts: OCT_POSTS, crossMonthPosts: [], beats: [] });
    return json({});
  }));
  return approves;
}

beforeEach(() => {
  window.innerWidth = 390;
  window.sessionStorage.clear();
  window.localStorage.clear();
  navTraceClear();
  resetNavSnapshot();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  const r = render(<PlanRoot {...init()} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return r;
}

/** Ask for the arc and apply it, letting the sequential approves settle. */
async function askAndApply() {
  fireEvent.click(screen.getByTestId('nav-mic'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'build the launch arc — two teasers and the launch post on the 31st' } });
  await act(async () => { fireEvent.click(screen.getByTestId('voice-submit')); });
  await act(async () => { fireEvent.click(screen.getByTestId('interp-apply')); });
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}

/** The last thing the agent said in the thread. */
const lastAgentTurn = () => {
  const turns = screen.getAllByTestId('turn-agent');
  return turns[turns.length - 1]!.textContent ?? '';
};

describe('THE OCTOBER CASE: a 3-item arc whose middle item a guard refuses', () => {
  const REFUSED = { 'pr-launch': { failed: true, message: '31 October has already passed, so I couldn’t add it there.' } };

  it('the two teasers apply and the launch post does not — the arc really is partial', async () => {
    const approves = stubNetwork(REFUSED);
    await mount();
    await askAndApply();
    // All three were attempted, in the order they were asked for. A refusal mid-arc must not
    // abort the ones behind it: what landed has landed.
    expect(approves).toEqual(['pr-tease-1', 'pr-launch', 'pr-tease-2']);
  });

  it('THE BUG: the confirmation turn names the launch post, and does not say "3 changes are in"', async () => {
    stubNetwork(REFUSED);
    await mount();
    await askAndApply();
    const said = lastAgentTurn();
    expect(said, `the confirmation turn said: ${said}`).toContain('Add “Launch day”');
    expect(said).not.toContain('3 changes are in');
  });

  it('and it says WHY — the guard’s own sentence, not a count', async () => {
    stubNetwork(REFUSED);
    await mount();
    await askAndApply();
    expect(lastAgentTurn()).toContain('31 October has already passed');
  });

  it('and offers the rescue in the thread the client is already standing in', async () => {
    stubNetwork(REFUSED);
    await mount();
    await askAndApply();
    const said = lastAgentTurn();
    expect(said).toContain('Tell me another date');
    // NOT "it's still here to try again": the guard consumed the proposal, so there is nothing
    // left to press. An invitation to retry a button that no longer exists is the second lie.
    expect(said).not.toContain('still here');
  });

  it('the two that DID apply are counted, named and highlighted — honestly, and only them', async () => {
    stubNetwork(REFUSED);
    await mount();
    await askAndApply();
    expect(lastAgentTurn()).toContain('2 changes went through');

    fireEvent.click(screen.getByTestId('voice-close'));
    expect(screen.getByTestId('summary-chip').textContent).toContain('2 added');
    fireEvent.click(screen.getByTestId('summary-chip'));
    const panel = screen.getByTestId('applied-panel').textContent ?? '';
    expect(panel).toContain('Teaser one');
    expect(panel).toContain('Teaser two');
    expect(panel, 'the refused item must never appear among what applied').not.toContain('Launch day');
  });

  it('a refusal with NO reason still names the item — silence about which one is the failure', async () => {
    // The pre-G3 server shape: a bare failed proposal. The status alone is enough to keep it
    // out of the applied list, which is the half that matters most.
    stubNetwork({ 'pr-launch': { status: 'failed' } });
    await mount();
    await askAndApply();
    const said = lastAgentTurn();
    expect(said).toContain('Add “Launch day”');
    expect(said).toContain('2 changes went through');
  });

  it('nothing refused → the confirmation is unchanged, and all three are counted', async () => {
    stubNetwork();
    await mount();
    await askAndApply();
    expect(lastAgentTurn()).toContain('3 changes are in');
    fireEvent.click(screen.getByTestId('voice-close'));
    expect(screen.getByTestId('summary-chip').textContent).toContain('3 added');
  });
});
