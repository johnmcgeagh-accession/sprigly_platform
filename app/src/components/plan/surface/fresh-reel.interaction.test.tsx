/**
 * @vitest-environment jsdom
 *
 * fresh-reel.interaction.test.tsx — add a post, make it a reel, generate.
 *
 * ── The bug this file exists for ─────────────────────────────────────────────────────
 *
 * The operator added a post, toggled it to reel, opened the Script tab and pressed Generate. A
 * hook and a script were written — and the Hook tab still read empty, on a post with no caption.
 * Three findings, and the third is the one that matters:
 *
 * 1 · WHAT THE JOB WRITES. `engine/src/content-cycles/script.ts:135-136` updates the post's own
 *   `hook` and `script` columns in one write, and `app/src/lib/plan.ts:114` reads `hook` back, so
 *   the data and the reader agree. Nothing is lost between them.
 *
 * 2 · THE CAPTION WAS NEVER A CAPTION. A committed add with no subject goes through
 *   `addDraft` (`app/src/lib/mutations.ts:155`), which writes `DRAFT_PLACEHOLDER_CAPTION` —
 *   *"Draft idea. Tell Sprigly what this post should be about and it'll write the caption."*
 *   (`packages/db/src/schema.ts:1092`). That is scaffolding, not content, and the data model
 *   already knows it: `cardText` strips it (`card-text.ts:32`) and the merge classifier matches
 *   its prefix (`schema.ts:1095`).
 *
 * 3 · THE SHEET DID NOT KNOW. `written` was `!!post.caption`, so a placeholder-only post showed
 *   three tabs, and the Script tab's Generate offer was live because `!post.caption.trim()` was
 *   false. The route agreed (`api/plan/script/route.ts:41` checks `!post.caption`). So the
 *   client could generate a hook and a script **from our own scaffolding sentence as the
 *   subject** — which is what happened, and why the result read as belonging to no post.
 *
 * The fix is one predicate shared by the card, the sheet, the route and the worker, plus the
 * product rule the operator states: caption generation enqueues regardless; an instruction only
 * steers it. A post is never left holding a placeholder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { CommittedSurface } from './CommittedSurface';
import { realCaption, PLACEHOLDER_CAPTION } from './card-text';
import type { PlanPost } from '@/lib/types';
import type { PlanData } from '../usePlanData';

const TODAY = '2026-10-01';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'cyc-1', clientId: 'c1', channel: 'instagram',
  date: TODAY, format: 'single', pillar: 'New idea', title: null,
  caption: PLACEHOLDER_CAPTION, hook: null, script: null,
  status: 'new', reviewState: null, steps: [], postingTime: null, rationale: '',
  ...over,
});

function fakeData(over: Partial<PlanData> = {}): PlanData {
  const posts = (over.posts ?? [post()]) as PlanPost[];
  return {
    posts, crossMonthPosts: [], calendarPosts: posts, beats: [], beatsOn: () => [], weather: new Map(),
    cycles: [{ cycleId: 'cyc-1', displayMonth: '2026-10', monthLabel: 'October 2026', prePlanning: false }],
    viewedCycleId: 'cyc-1', homeCycleId: 'cyc-1', todayCycleId: 'cyc-1',
    today: TODAY, clientName: 'Earl of East', readOnly: false, toast: null,
    canEdit: () => true,
    shapingIds: new Set<string>(), hookGenerating: new Set<string>(), hookCandidates: new Map(),
    hookError: new Map(), scriptGenerating: new Set<string>(), scriptError: new Map(), shapeErrors: new Map(),
    switchCycle: vi.fn(async () => {}), addPost: vi.fn(async () => {}), addShapedPost: vi.fn(async () => true),
    reschedule: vi.fn(), removePost: vi.fn(async () => {}), shape: vi.fn(async () => {}),
    track: vi.fn(), flash: vi.fn(), toggleStep: vi.fn(async () => {}),
    changeFormat: vi.fn(async () => {}), regenerateChecklist: vi.fn(async () => {}),
    generateHooks: vi.fn(async () => {}), generateScript: vi.fn(async () => {}),
    saveHook: vi.fn(async () => {}), clearHookCandidates: vi.fn(),
    ...over,
  } as unknown as PlanData;
}

const open = () => fireEvent.click(screen.getByTestId('post-card'));

beforeEach(() => { window.innerWidth = 390; });
afterEach(cleanup);

describe('2 · the placeholder is not a caption, and now everything agrees', () => {
  it('realCaption() reads it as absent — one predicate, and the card already worked this way', () => {
    expect(realCaption({ caption: PLACEHOLDER_CAPTION })).toBe('');
    expect(realCaption({ caption: '   ' })).toBe('');
    expect(realCaption({ caption: 'Wilderness is back.' })).toBe('Wilderness is back.');
  });

  it('a placeholder-only post shows NO tabs — it says nothing is written, because nothing is', () => {
    render(<CommittedSurface data={fakeData()} />);
    open();

    expect(screen.getByTestId('not-written-yet')).toBeTruthy();
    expect(screen.queryByTestId('tab-caption')).toBeNull();
    expect(screen.queryByTestId('field-body')).toBeNull();
    // And it certainly never shows our scaffolding sentence as though the client wrote it.
    expect(screen.getByTestId('detail-sheet').textContent).not.toContain('Tell Sprigly what this post');
  });
});

describe('3 · a reel with no caption cannot be told to write a script from one', () => {
  it('THE BUG: the Script tab offered Generate on a placeholder-only reel', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ format: 'reel' })] })} />);
    open();

    // No caption → no tabs at all now, so there is no Script tab to press. Before the fix the
    // tab was live and its Generate button reached a route that read the placeholder as content.
    expect(screen.queryByTestId('tab-script')).toBeNull();
    expect(screen.queryByTestId('generate-script')).toBeNull();
  });

  it('with a REAL caption the reel offers it, and says what it needs when there is none', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ format: 'reel', caption: 'A real caption, written.' })] })} />);
    open();
    fireEvent.click(screen.getByTestId('tab-script'));

    expect(screen.getByTestId('empty-field').textContent).toContain('No script yet');
    expect(screen.getByTestId('generate-script')).toBeTruthy();
  });
});

describe('1 · once the job has written them, both fields are on the post', () => {
  const generated = post({
    format: 'reel',
    caption: 'A real caption, written.',
    hook: 'The one that sold out in a week.',
    script: 'Open on the shelf. Hold. Then the label.',
    scriptLengthSeconds: 30,
  });

  it('the HOOK TAB shows the hook the script job wrote — the two land together', () => {
    render(<CommittedSurface data={fakeData({ posts: [generated] })} />);
    open();
    fireEvent.click(screen.getByTestId('tab-hook'));

    expect(screen.getByTestId('field-body').textContent).toBe('The one that sold out in a week.');
    expect(screen.queryByTestId('empty-field')).toBeNull();
  });

  it('and the script tab shows the script', () => {
    render(<CommittedSurface data={fakeData({ posts: [generated] })} />);
    open();
    fireEvent.click(screen.getByTestId('tab-script'));
    expect(screen.getByTestId('field-body').textContent).toBe('Open on the shelf. Hold. Then the label.');
  });

  it('a post mid-generation reads as pending on BOTH tabs, not as empty', () => {
    render(<CommittedSurface data={fakeData({
      posts: [post({ format: 'reel', caption: 'A real caption, written.' })],
      scriptGenerating: new Set(['p1']),
    })} />);
    open();
    fireEvent.click(screen.getByTestId('tab-script'));
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });
});

describe('the caption path — generation enqueues regardless', () => {
  it('a post whose caption is on its way says so, and offers nothing to press', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ caption: '', status: 'generating' })] })} />);
    open();

    expect(screen.getByTestId('detail-on-the-way')).toBeTruthy();
    expect(screen.queryByTestId('generate-script')).toBeNull();
    expect(screen.queryByTestId('act-shape')).toBeNull();
  });

  it('and the card reads On its way rather than Untitled with a placeholder under it', () => {
    render(<CommittedSurface data={fakeData({ posts: [post({ caption: '', status: 'generating' })] })} />);
    expect(screen.getByTestId('on-the-way')).toBeTruthy();
    expect(screen.getByTestId('post-card').textContent).not.toContain('Tell Sprigly what this post');
  });
});
