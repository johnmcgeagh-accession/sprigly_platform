/**
 * @vitest-environment jsdom
 *
 * ideas.interaction.test.tsx — the Ideas view, driven. (W6)
 *
 * ── What is worth pinning here ───────────────────────────────────────────────────────
 *
 * The derivation has its own unit file (`@/lib/ideas.test.ts`). This one is about the promises
 * the SURFACE makes, each of which would pass a render assertion while being wrong:
 *
 *   IT IS A DESTINATION, not a panel. Choosing it takes the whole plan region — the month and
 *   the day go, the conversation stays — because the sentences in it outlive the month on screen.
 *
 *   IT IS READ-ONLY, and that has to be checkable rather than asserted in a comment. The one
 *   control on a row is a tap-through to a post; there is no add, no edit, no delete anywhere
 *   in the view.
 *
 *   THE TAP-THROUGH CANNOT DEAD-END. A beat's `sourceRef` can point at a post in a month the
 *   client is not looking at, and `onOpen` resolves ids against the loaded plan. Where the post
 *   is out of view the title is still shown — as text, with no control on it.
 *
 *   THE COUNT AND THE LINK AGREE WITH THE DATA. The rail's number and the month summary's
 *   "N ideas you gave us" line both have to land somewhere real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import { DraftSurface } from './DraftSurface';
import type { IdeaView } from '@/lib/ideas';
import type { DraftBeatView, PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'reel', pillar: 'Home & Space', title: 'Friday, at home',
  caption: 'A caption.', hook: null, script: null,
  status: 'new', reviewState: null, steps: [], postingTime: '06:00', rationale: '',
  ...over,
});

const idea = (over: Partial<IdeaView> = {}): IdeaView => ({
  id: 'i1', content: 'make Fridays more personal', createdAt: '2026-07-02T09:00:00.000Z',
  state: 'waiting', usedInMonth: null, usedInCycleId: null, postId: null, postTitle: null,
  ...over,
});

function base(over: Partial<PlanData> = {}): PlanData {
  return {
    posts: [post()], crossMonthPosts: [], calendarPosts: [post()], beats: [], beatsOn: () => [],
    weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: true }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false, toast: null,
    canEdit: () => true, setDraft: vi.fn(),
    switchCycle: vi.fn(async () => {}), track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    shapingIds: new Set<string>(), hookGenerating: new Set<string>(), hookCandidates: new Map(),
    hookError: new Map(), scriptGenerating: new Set<string>(), scriptError: new Map(), shapeErrors: new Map(),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    addPost: vi.fn(async () => {}), addShapedPost: vi.fn(async () => true),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ideas: [], ideasError: false,
    proposals: [], agentBusy: false, agentToast: null,
    ask: vi.fn(async () => null), applyChanges: vi.fn(async () => ({ applied: [], failures: [], changedPostIds: [] })),
    discardChanges: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

/** Land on Ideas and hand back the panel. */
function openIdeas(data: PlanData) {
  render(<CommittedSurface data={data} frame="desktop" />);
  fireEvent.click(screen.getByTestId('rail-ideas'));
  return screen.getByTestId('ideas-panel');
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.innerWidth = 1440;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ideas: [] }) }) as unknown as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Ideas is a destination', () => {
  it('takes the whole plan region — the month and the day both go', () => {
    openIdeas(base({ ideas: [idea()] } as Partial<PlanData>));

    expect(screen.getByTestId('plan-region')).toBeTruthy();
    expect(screen.queryByTestId('month-col')).toBeNull();
    expect(screen.queryByTestId('day-col')).toBeNull();
    expect(screen.queryByTestId('tasks-panel')).toBeNull();
  });

  it('leaves the conversation mounted — it is a region of the shell, not a view', () => {
    openIdeas(base({ ideas: [idea()] } as Partial<PlanData>));
    expect(screen.getByTestId('conversation-dock')).toBeTruthy();
  });

  it('goes back to the plan, with the month and day where they were', () => {
    openIdeas(base({ ideas: [idea()] } as Partial<PlanData>));
    fireEvent.click(screen.getByTestId('rail-plan'));

    expect(screen.queryByTestId('ideas-panel')).toBeNull();
    expect(screen.getByTestId('month-col')).toBeTruthy();
    expect(screen.getByTestId('day-col')).toBeTruthy();
  });

  it('the rail carries the count, so "is any of what I said in there" is answerable without a click', () => {
    render(<CommittedSurface data={base({ ideas: [idea(), idea({ id: 'i2' })] } as Partial<PlanData>)} frame="desktop" />);
    expect(screen.getByTestId('rail-ideas-count').textContent).toBe('2');
  });
});

describe('the words are hers, and the state is derived', () => {
  it('shows the sentence verbatim, in quotation marks, and does not paraphrase it', () => {
    const panel = openIdeas(base({
      ideas: [idea({ content: 'make Fridays more personal' })],
    } as Partial<PlanData>));
    expect(panel.textContent).toContain('“make Fridays more personal”');
  });

  it('names the month a used idea ran in', () => {
    const panel = openIdeas(base({
      ideas: [idea({ state: 'used', usedInMonth: 'September 2026' })],
    } as Partial<PlanData>));
    expect(within(panel).getByTestId('idea-state').textContent).toBe('Used in September 2026');
  });

  it('says "waiting" and "deferred to next month" in those words, on the heading', () => {
    // The state is on the group, not repeated under every row in it — four rows under a
    // "WAITING" heading each ending in the word "Waiting" is noise dressed as information.
    const panel = openIdeas(base({
      ideas: [idea({ state: 'waiting' }), idea({ id: 'i2', state: 'deferred' })],
    } as Partial<PlanData>));
    const headings = within(panel).getAllByTestId('ideas-group').map((g) => g.textContent ?? '');
    expect(headings.some((h) => h.includes('Waiting'))).toBe(true);
    expect(headings.some((h) => h.includes('Deferred to next month'))).toBe(true);
    // …and the rows themselves carry no state line, because neither has a month to add.
    expect(within(panel).queryAllByTestId('idea-state')).toHaveLength(0);
  });

  it('only a USED row says its own state, because only that one has a month to add', () => {
    const panel = openIdeas(base({
      ideas: [
        idea({ state: 'waiting' }),
        idea({ id: 'i2', state: 'used', usedInMonth: 'September 2026' }),
        idea({ id: 'i3', state: 'set-aside' }),
      ],
    } as Partial<PlanData>));
    const states = within(panel).getAllByTestId('idea-state').map((e) => e.textContent);
    expect(states).toEqual(['Used in September 2026']);
  });

  it('groups by state, live first and finished last', () => {
    const panel = openIdeas(base({
      ideas: [
        idea({ id: 'w', state: 'waiting' }),
        idea({ id: 'd', state: 'deferred' }),
        idea({ id: 'u', state: 'used' }),
        idea({ id: 's', state: 'set-aside' }),
      ],
    } as Partial<PlanData>));
    const order = within(panel).getAllByTestId('ideas-group').map((e) => e.getAttribute('data-state'));
    expect(order).toEqual(['waiting', 'deferred', 'used', 'set-aside']);
  });

  it('does not draw a group nobody is in', () => {
    const panel = openIdeas(base({ ideas: [idea({ state: 'waiting' })] } as Partial<PlanData>));
    expect(within(panel).getAllByTestId('ideas-group')).toHaveLength(1);
    expect(panel.textContent).not.toContain('Set aside');
  });
});

describe('the tap-through to the beat it became', () => {
  it('opens the post, in the day column, with the panel gone', () => {
    const data = base({
      ideas: [idea({ state: 'used', usedInMonth: 'October 2026', postId: 'p1', postTitle: 'Friday, at home' })],
    } as Partial<PlanData>);
    const panel = openIdeas(data);

    fireEvent.click(within(panel).getByTestId('idea-post'));

    // Opening a post is a PLAN act: it returns to the plan region and takes the day column's
    // slot, which is where every other route into a post lands.
    expect(screen.queryByTestId('ideas-panel')).toBeNull();
    expect(within(screen.getByTestId('day-col')).getByTestId('detail-sheet')).toBeTruthy();
  });

  it('does NOT offer a control for a post this month has not loaded', () => {
    // The sourceRef points at a real post in another cycle. A button here would visibly do
    // nothing, so the title is shown as text instead — the fact survives, the dead end does not.
    const panel = openIdeas(base({
      ideas: [idea({ state: 'used', usedInMonth: 'June 2026', postId: 'p-elsewhere', postTitle: 'A June post' })],
    } as Partial<PlanData>));

    expect(within(panel).queryByTestId('idea-post')).toBeNull();
    expect(within(panel).getByTestId('idea-post-text').textContent).toBe('A June post');
  });

  it('shows a used idea with no post at all as a plain statement', () => {
    const panel = openIdeas(base({
      ideas: [idea({ state: 'used', usedInMonth: 'September 2026' })],
    } as Partial<PlanData>));
    expect(within(panel).queryByTestId('idea-post')).toBeNull();
    expect(within(panel).queryByTestId('idea-post-text')).toBeNull();
    expect(within(panel).getByTestId('idea-state').textContent).toBe('Used in September 2026');
  });
});

describe('read-only, and provably so', () => {
  it('the only control in the view is the tap-through — no add, no edit, no delete', () => {
    const panel = openIdeas(base({
      ideas: [
        idea({ id: 'a' }),
        idea({ id: 'b', state: 'used', usedInMonth: 'October 2026', postId: 'p1', postTitle: 'Friday, at home' }),
        idea({ id: 'c', state: 'set-aside' }),
      ],
    } as Partial<PlanData>));

    const controls = [
      ...within(panel).queryAllByRole('button'),
      ...within(panel).queryAllByRole('textbox'),
      ...within(panel).queryAllByRole('checkbox'),
    ];
    expect(controls).toHaveLength(1);
    expect(controls[0]!.getAttribute('data-testid')).toBe('idea-post');
  });
});

describe('the empty state teaches the add path', () => {
  it('keeps the old Notes’ framing, example and all', () => {
    const panel = openIdeas(base({ ideas: [] } as Partial<PlanData>));
    const empty = within(panel).getByTestId('ideas-empty');

    expect(empty.textContent).toContain('When you tell Sprigly things like');
    expect(empty.textContent).toContain('make Fridays more personal');
    expect(empty.textContent).toContain('they’re captured here');
    // It says what saying something DOES. It does not report a zero.
    expect(empty.textContent).not.toContain('0');
  });

  it('is NOT laid out in columns — a heading and its sentence are one thing', () => {
    // Found by screenshot: with the two-column flow always on, "Nothing here yet" landed in the
    // first column and the sentence explaining it in the second, halfway across the screen.
    // Multi-column does not know they belong together, so it is off when there is nothing to
    // flow. The populated case keeps it — see the group test above.
    const panel = openIdeas(base({ ideas: [] } as Partial<PlanData>));
    expect(panel.className).not.toContain('columns-2');

    const populated = base({ ideas: [idea()] } as Partial<PlanData>);
    cleanup();
    expect(openIdeas(populated).className).toContain('wide:columns-2');
  });

  it('says the list could not be read rather than showing an empty one', () => {
    // A failed fetch and a client who has never said anything are different facts, and the
    // empty state's copy would be a lie about the second.
    const panel = openIdeas(base({ ideas: [], ideasError: true } as Partial<PlanData>));
    expect(within(panel).getByTestId('ideas-error')).toBeTruthy();
    expect(within(panel).queryByTestId('ideas-empty')).toBeNull();
  });
});

describe('the month summary’s "ideas you gave us" line', () => {
  const beat = (over: Partial<DraftBeatView> = {}): DraftBeatView => ({
    id: 'b1', cycleId: 'cyc-1', date: TODAY, format: 'reel', pillar: 'Home & Space',
    title: 'Friday, at home', position: 0, slotType: 'proven',
    evidence: {
      basis: 'client_input', reason: 'You asked for this',
      backlogIdea: { text: 'make Fridays more personal', givenAt: '2026-07-02' },
    },
    assumptions: [],
    ...over,
  });

  const draftData = () => base({
    surfaceKind: 'draft',
    ideas: [idea()],
    draft: { beats: [beat()], pillars: ['Home & Space'], editable: true, receipts: [] },
  } as Partial<PlanData>);

  /** On desktop a THIN month opens its own argument (D6), so the panel may already be open —
   *  toggling unconditionally would close it. Open it only if it is shut. */
  const openSummary = () => {
    if (!screen.queryByTestId('draft-summary-detail')) fireEvent.click(screen.getByTestId('draft-summary-toggle'));
  };

  it('is a way into Ideas, not just a sentence', () => {
    render(<DraftSurface data={draftData()} frame="desktop" />);
    openSummary();

    const link = screen.getByTestId('summary-ideas');
    expect(link.textContent).toContain('idea');
    expect(link.textContent).toContain('you gave us');

    fireEvent.click(link);
    expect(screen.getByTestId('ideas-panel')).toBeTruthy();
  });

  it('stays a plain statement on the phone, where there is no rail to send anyone to', () => {
    render(<DraftSurface data={draftData()} />);
    openSummary();

    expect(screen.queryByTestId('summary-ideas')).toBeNull();
    const section = screen.getAllByTestId('draft-summary-section').find((s) => s.getAttribute('data-section') === 'client');
    expect(section?.textContent).toContain('you gave us');
  });
});
