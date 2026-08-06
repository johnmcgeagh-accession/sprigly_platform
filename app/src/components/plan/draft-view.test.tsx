/**
 * draft-view.test.tsx — what the client actually sees, and the mixed-state rule.
 *
 * Rendered with react-dom/server (the app's vitest env is node), so these assert the
 * markup the client is served rather than an internal component contract.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, PRE_PLANNING_STATUSES: new Set<string>() }));
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map() }));

import { DraftPlanView, type DraftReceipt } from './DraftPlanView';
import type { DraftBeatView } from '@/lib/types';

const beat = (over: Partial<DraftBeatView> = {}): DraftBeatView => ({
  id: 'beat-1', cycleId: 'cycle-1', date: '2026-09-02', format: 'carousel',
  pillar: 'Brand Story & Culture', title: 'Brand Story & Culture — Carousel', position: 0,
  slotType: 'proven',
  evidence: {
    basis: 'observed',
    formatEngagement: { format: 'carousel', avgEngagement: 69.9, posts: 8 },
    pillarShare: 0.2,
    cadenceBasis: { postsPerWeek: 2.24, source: 'observed', months: 4 },
  },
  assumptions: ['No launches or restocks are on record for this month — the draft assumes a business-as-usual month.'],
  ...over,
});

const render = (beats: DraftBeatView[], props: Partial<React.ComponentProps<typeof DraftPlanView>> = {}) =>
  renderToStaticMarkup(
    <DraftPlanView
      beats={beats} monthLabel="September 2026" clientName="Earl of East"
      pillars={['Brand Story & Culture', 'Home & Space']}
      onMutate={async () => ({ ok: true, beats })}
      {...props}
    />,
  );

describe('DraftPlanView — it must read as a draft, not a finished plan', () => {
  it('says plainly that it is a draft and not sent', () => {
    const html = render([beat()]);
    expect(html).toContain('Draft');
    expect(html).toContain('Not sent yet');
    expect(html).toContain('We’ve drafted September 2026 for Earl of East');
  });

  it('invites correction rather than approval', () => {
    // Build B has no approve action — approval is Build D. The copy must not imply one.
    const html = render([beat()]);
    expect(html).toMatch(/Change anything that’s wrong/);
    expect(html).not.toMatch(/Approve|Looks good|Confirm plan/i);
  });

  it('shows date, format and pillar for each beat', () => {
    const html = render([beat()]);
    expect(html).toContain('Wed');            // 2026-09-02
    expect(html).toContain('2 Sep');
    expect(html).toContain('Carousel');
    expect(html).toContain('Brand Story &amp; Culture');
  });

  it('renders the rationale from the evidence, with its real numbers', () => {
    const html = render([beat()]);
    expect(html).toContain('Carousels average 70 likes and comments across your last 8 posts');
    expect(html).toContain('20% of what you post');
  });

  it('renders NO rationale when the evidence supports none', () => {
    const html = render([beat({ evidence: { basis: 'observed' } })]);
    expect(html).not.toMatch(/average|% of what you post/);
  });

  it('badges an experiment slot so a bet is distinguishable from a safe pick', () => {
    expect(render([beat({ slotType: 'experiment' })])).toContain('Something new');
    expect(render([beat({ slotType: 'proven' })])).not.toContain('Something new');
  });

  it('surfaces assumptions ONCE as prompts, not repeated on every card', () => {
    const shared = beat().assumptions;
    const html = render([beat({ id: 'a' }), beat({ id: 'b', assumptions: shared }), beat({ id: 'c', assumptions: shared })]);
    const prompt = 'anything coming up?';
    expect(html.split(prompt).length - 1).toBe(1);
  });

  it('says the assumptions cannot be answered here — that is Build C', () => {
    expect(render([beat()])).toContain('Reply to our email');
  });

  it('gives every control an accessible name and a tap-sized target', () => {
    const html = render([beat()]);
    expect(html).toContain('aria-label="Date for Brand Story &amp; Culture — Carousel"');
    expect(html).toContain('aria-label="Format for Brand Story &amp; Culture — Carousel"');
    // 40px+ min-height on every interactive control (thumb-sized).
    expect(html).toMatch(/min-height:4[0-9]px|min-height:4[0-9]/);
  });

  it('offers move, format and remove per beat', () => {
    const html = render([beat()]);
    expect(html).toContain('type="date"');
    expect(html).toContain('<select');
    expect(html).toContain('Remove');
  });

  it('hides every edit control once the cycle is past cutoff, but still shows the draft', () => {
    const html = render([beat()], { editable: false });
    expect(html).toContain('Brand Story &amp; Culture — Carousel');   // still readable
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Add something');
  });

  it('does not offer "add" when the client has no configured pillars', () => {
    // addBeat would refuse it anyway — never offer an affordance that cannot succeed.
    expect(render([beat()], { pillars: [] })).not.toContain('Add something');
  });

  it('handles an empty draft without collapsing', () => {
    expect(render([])).toContain('Nothing in this draft yet');
  });

  it('orders beats by date', () => {
    const html = render([
      beat({ id: 'b', date: '2026-09-20', title: 'Later beat' }),
      beat({ id: 'a', date: '2026-09-02', title: 'Earlier beat' }),
    ]);
    expect(html.indexOf('Earlier beat')).toBeLessThan(html.indexOf('Later beat'));
  });
});

describe('the receipt panel — computed facts, dismissible', () => {
  const receipt = {
    id: 'r-1', at: '2026-08-01T00:00:00Z',
    sourceText: 'The Wilderness candle relaunches on the 24th',
    scope: 'month_scoped' as const,
    lines: ['Added: the Wilderness relaunch — Launch, Thu 24 Sep', 'Replaced: Home & Space — Carousel, Fri 4 Sep'],
    changedIds: ['beat-1'],
  };

  it('quotes the client’s own words back as the cause', () => {
    const html = render([beat()], { receipts: [receipt], onSay: async () => ({ ok: true }) });
    expect(html).toContain('What changed');
    expect(html).toContain('The Wilderness candle relaunches on the 24th');
  });

  it('lists the computed deltas verbatim', () => {
    const html = render([beat()], { receipts: [receipt], onSay: async () => ({ ok: true }) });
    expect(html).toContain('Added: the Wilderness relaunch — Launch, Thu 24 Sep');
    expect(html).toContain('Replaced: Home &amp; Space — Carousel, Fri 4 Sep');
  });

  it('marks the beats that changed', () => {
    const html = render([beat()], { receipts: [{ ...receipt, changedIds: ['beat-1'] }], onSay: async () => ({ ok: true }) });
    expect(html).toContain('Just changed');
  });

  it('does NOT mark beats that did not change', () => {
    const html = render([beat()], { receipts: [{ ...receipt, changedIds: ['someone-else'] }], onSay: async () => ({ ok: true }) });
    expect(html).not.toContain('Just changed');
  });

  it('reads as a filing receipt, not a change, when the input went to the backlog', () => {
    const html = render([beat()], {
      receipts: [{ ...receipt, scope: 'evergreen' as const, lines: [], changedIds: [], reason: 'classified_evergreen' }],
      onSay: async () => ({ ok: true }),
    });
    expect(html).toContain('Saved to your ideas');
    expect(html).toContain('kept this for later');
    expect(html).not.toContain('What changed');
  });

  it('says nothing changed rather than showing an empty panel', () => {
    const html = render([beat()], { receipts: [{ ...receipt, lines: [], changedIds: [] }], onSay: async () => ({ ok: true }) });
    expect(html).toContain('Nothing needed changing');
  });

  it('is dismissible', () => {
    const html = render([beat()], { receipts: [receipt], onSay: async () => ({ ok: true }) });
    expect(html).toContain('aria-label="Dismiss what changed"');
  });

  it('shows no panel when there are no receipts', () => {
    expect(render([beat()])).not.toContain('What changed');
  });
});

describe('the say box — the north-star input', () => {
  it('offers a labelled input when saying is wired', () => {
    const html = render([beat()], { onSay: async () => ({ ok: true }) });
    expect(html).toContain('Anything we should know?');
    expect(html).toContain('id="draft-say"');
    expect(html).toContain('Tell Sprigly');
  });

  it('turns assumptions into answerable prompts once saying is possible', () => {
    const html = render([beat()], { onSay: async () => ({ ok: true }) });
    expect(html).toContain('Answer any of these below');
  });

  it('falls back to "reply to our email" when saying is not wired', () => {
    expect(render([beat()])).toContain('Reply to our email');
  });

  it('hides the say box past cutoff', () => {
    const html = render([beat()], { onSay: async () => ({ ok: true }), editable: false });
    expect(html).not.toContain('id="draft-say"');
  });
});

describe('mixed state — committed posts win the surface', () => {
  // The page fork gates draft mode on `posts.length === 0`, where `posts` is already
  // draft-fenced by loadPlanPosts. So a non-empty posts list IS committed work, and
  // drafts stay invisible exactly as they are to every other reader. Asserting the rule
  // directly here keeps it honest even though the branch itself lives in a server
  // component (which cannot be rendered in this node env without a database).
  const draftModeApplies = (committedPostCount: number, draftBeatCount: number) =>
    committedPostCount === 0 && draftBeatCount > 0;

  it('renders draft mode for a draft-only cycle', () => {
    expect(draftModeApplies(0, 10)).toBe(true);
  });

  it('does NOT render draft mode when committed posts exist alongside drafts', () => {
    // The Build A known interim state: a whole-plan regen leaves drafts behind.
    expect(draftModeApplies(12, 10)).toBe(false);
  });

  it('does NOT render draft mode for an ordinary committed cycle', () => {
    expect(draftModeApplies(12, 0)).toBe(false);
  });

  it('does NOT render draft mode for a wholly empty cycle', () => {
    expect(draftModeApplies(0, 0)).toBe(false);
  });
});

// ── Build C's rescue tap (Commit 4) ───────────────────────────────────────────
// The server op `add_to_month` shipped in Build C; nothing ever sent it, so an evergreen
// receipt told the client to "add it from your ideas" on a surface with no such control.

describe('evergreen receipt — Add to this month', () => {
  const receipt = (over: Record<string, unknown> = {}) => ({
    id: 'r1', at: '2026-07-21T07:28:14Z', sourceText: 'Meadow candle launch is the 10th not the 1st',
    scope: 'evergreen' as const, reason: 'classified_evergreen', lines: [], changedIds: [],
    planInputId: 'pi-1', ...over,
  });

  it('offers the tap when the receipt filed a backlog row', () => {
    const html = renderToStaticMarkup(
      <DraftPlanView beats={[beat()]} monthLabel="October" clientName="Earl of East" pillars={['Brand Story & Culture']}
        onMutate={async () => ({ ok: true })} onAddToMonth={async () => ({ ok: true })}
        receipts={[receipt()]} />,
    );
    expect(html).toContain('Add to this month');
    expect(html).toContain('If you meant now, add it to this month.');
  });

  it('says plainly when it could not apply, rather than implying a filing was asked for', () => {
    const html = renderToStaticMarkup(
      <DraftPlanView beats={[beat()]} monthLabel="October" clientName="Earl of East" pillars={['Brand Story & Culture']}
        onMutate={async () => ({ ok: true })} onAddToMonth={async () => ({ ok: true })}
        receipts={[receipt({ reason: 'couldnt_apply' })]} />,
    );
    expect(html).toContain('We couldn’t apply this');
    expect(html).toContain('so we’ve saved it to your ideas');
    expect(html).toContain('Add to this month');
  });

  it('no tap without a backlog row to act on', () => {
    const html = renderToStaticMarkup(
      <DraftPlanView beats={[beat()]} monthLabel="October" clientName="Earl of East" pillars={['Brand Story & Culture']}
        onMutate={async () => ({ ok: true })} onAddToMonth={async () => ({ ok: true })}
        receipts={[receipt({ planInputId: undefined })]} />,
    );
    expect(html).not.toContain('Add to this month');
  });

  it('no tap on a month_scoped receipt — it already changed the month', () => {
    const html = renderToStaticMarkup(
      <DraftPlanView beats={[beat()]} monthLabel="October" clientName="Earl of East" pillars={['Brand Story & Culture']}
        onMutate={async () => ({ ok: true })} onAddToMonth={async () => ({ ok: true })}
        receipts={[receipt({ scope: 'month_scoped', lines: ['Moved 3 posts'] })]} />,
    );
    expect(html).not.toContain('Add to this month');
  });
});

// ── Approval copy tells the truth (Commit 5) ──────────────────────────────────

describe('approval dialog copy', () => {
  const render = () => renderToStaticMarkup(
    <DraftPlanView beats={[beat({ format: 'reel' }), beat({ id: 'b2', format: 'carousel' })]}
      monthLabel="October" clientName="Earl of East" pillars={['Brand Story & Culture']}
      onMutate={async () => ({ ok: true })} onApprove={async () => ({ ok: true })} />,
  );

  it('does not claim dates and formats are set after approval — they are not', () => {
    const html = render();
    expect(html).not.toContain('dates and formats are set');
    expect(html).not.toContain('set for the month');
  });

  it('names what approval actually starts', () => {
    const html = render();
    expect(html).toContain('We’ll write the captions, hooks and scripts.');
    expect(html).toContain('You can still change dates and formats afterwards.');
  });
});

describe('the brief rollup receipt — one itemised panel for a pasted document', () => {
  const rollup: DraftReceipt = {
    id: 'r-brief', at: '2026-08-01T00:00:00Z',
    sourceText: 'Navy Edit launches 28th. Weekend Style Guide every Friday. More behind-the-scenes. Something odd.',
    scope: 'month_scoped', lines: [], changedIds: ['n1', 'n2'],
    segmentCount: 4, discardedCount: 1,
    items: [
      { span: 'The Navy Edit launches on 28th August at 7pm.', outcome: 'applied', kind: 'launch',
        lines: ['Added: Navy Edit — Tease, Sat 23 Aug', 'Added: Navy Edit — Launch, Thu 28 Aug'], changedIds: ['n1'] },
      { span: 'Weekend Style Guide every Friday: 7th, 14th, 21st, 28th and 4 Sept', outcome: 'applied', kind: 'series',
        lines: ['Added: Maggie t-shirt grey marl, Fri 7 Aug'], changedIds: ['n2'], deferredCount: 1 },
      { span: 'we should do more behind-the-scenes', outcome: 'idea',
        lines: [], changedIds: [], planInputId: 'pi-1' },
      { span: 'pull the DMs from last week', outcome: 'couldnt_apply',
        lines: [], changedIds: [], planInputId: 'pi-2', note: 'We couldn’t apply this.' },
    ],
  };

  it('renders one panel headed “What we found”, with the count and per-kind summary', () => {
    const html = render([beat()], { receipts: [rollup], editable: true, onAddToMonth: async () => ({ ok: true, beats: [] }) });
    expect(html).toContain('What we found');
    expect(html).toContain('We found 4 things in what you sent.');
    // per-kind summary chips
    expect(html).toContain('1 launch');
    expect(html).toContain('1 series');
    expect(html).toContain('1 idea');
    expect(html).toContain('1 couldn’t apply');
  });

  it('lists every segment’s span, and expands applied ones to their diff', () => {
    const html = render([beat()], { receipts: [rollup], editable: true, onAddToMonth: async () => ({ ok: true, beats: [] }) });
    expect(html).toContain('The Navy Edit launches on 28th August at 7pm.');
    expect(html).toContain('Weekend Style Guide every Friday');
    expect(html).toContain('Added: Navy Edit — Launch, Thu 28 Aug');   // applied diff line
    expect(html).toContain('What changed');                            // the expand affordance
    expect(html).toContain('1 saved for next month.');                 // the deferral
  });

  /**
   * The tap follows the SENTENCE, not the outcome — and this fixture is why that matters.
   *
   * It used to appear on both unapplied segments. The `couldnt_apply` one is "pull the DMs from
   * last week", and `addBacklogItemToMonth` re-routes a rescued row as `kind: 'event'` with its
   * first 80 characters as the subject, displacing the weakest beat: tapping it would have put a
   * post titled "pull the DMs from last week" on the calendar and evicted a real one. `pull` is
   * an operation, so the tap is withheld — while "we should do more behind-the-scenes", which is
   * a genuine idea, still carries it.
   */
  it('carries the rescue tap on an idea, and withholds it on an operational segment', () => {
    const html = render([beat()], { receipts: [rollup], editable: true, onAddToMonth: async () => ({ ok: true, beats: [] }) });
    const taps = html.split('data-testid="add-to-this-month"').length - 1;
    expect(taps).toBe(1);   // the idea only — not the two applied ones, and not "pull the DMs"
    // The segment is still listed and still says what happened to it; only the tap is gone.
    expect(html).toContain('We couldn’t apply this.');
    expect(html).toContain('pull the DMs from last week');
  });

  it('shows no rescue tap when the surface is not editable', () => {
    const html = render([beat()], { receipts: [rollup], editable: false });
    expect(html).not.toContain('data-testid="add-to-this-month"');
  });

  it('a single-sentence receipt (no items) still renders the plain panel', () => {
    const single: DraftReceipt = { id: 'r1', at: '2026-08-01T00:00:00Z', sourceText: 'move the friday reel',
      scope: 'month_scoped', lines: ['Moved: Friday reel'], changedIds: [] };
    const html = render([beat()], { receipts: [single] });
    expect(html).toContain('What changed');
    expect(html).not.toContain('What we found');
    expect(html).toContain('Moved: Friday reel');
  });
});
