/**
 * ClientHealthPanel.test.tsx — the markup an operator is actually served.
 *
 * The fence beside this file checks the SOURCE. This checks the OUTPUT, because the two failures
 * that matter are both facts about rendered text: a percentage that arrives without its
 * denominator, and a month with no answer that renders as a number anyway.
 *
 * Rendered with react-dom/server (the admin vitest env is node), matching IntakePanel.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MonthHealth } from '@sprigly/engine/caption-overlap';
import { ClientHealthPanel } from './ClientHealthPanel';

/** Ivy T's July, as the loader actually produces it. */
const JULY: MonthHealth = {
  state: 'measured',
  month: '2026-07',
  published: 36,
  matched: 10,
  adoption: 10 / 36,
  divergence: 0.039,
  matches: [],
  chainsWithoutSpriglyText: 0,
};

const render = (props: Partial<Parameters<typeof ClientHealthPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <ClientHealthPanel
      clientId="c1"
      channel="instagram"
      showChannel={false}
      current={JULY}
      latestMeasured={null}
      poolSize={80}
      poolWithoutSpriglyText={0}
      {...props}
    />,
  );

/** Tags stripped, entities resolved — what a person reads, not what React emits. */
const text = (html: string) =>
  html.replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&rsquo;/g, '’')
      .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

describe('the numbers carry their denominators', () => {
  it('renders the count before the percentage, never the percentage alone', () => {
    const t = text(render());
    expect(t).toContain('10 of 36');
    expect(t).toContain('27.8%');
    // The order matters: the sample is read first.
    expect(t.indexOf('10 of 36')).toBeLessThan(t.indexOf('27.8%'));
  });

  it('divergence carries the number of pairs it averages over', () => {
    const t = text(render());
    expect(t).toContain('3.9%');
    expect(t).toContain('across 10 matched posts');
  });

  it('a single matched pair says "post", not "posts" — one pair is not a trend', () => {
    const t = text(render({ current: { ...JULY, matched: 1, adoption: 1 / 36, divergence: 0.02 } }));
    expect(t).toContain('across 1 matched post');
    expect(t).not.toContain('across 1 matched posts');
  });

  it('names the month it is describing', () => {
    expect(text(render())).toContain('July 2026');
  });
});

describe('a measured zero is a zero; an unknown is not', () => {
  it('0 of 29 renders as a measured zero with its denominator', () => {
    const t = text(render({
      current: { ...JULY, month: '2026-06', published: 29, matched: 0, adoption: 0, divergence: null },
    }));
    expect(t).toContain('0 of 29');
    expect(t).toContain('0%');
    // Divergence has nothing to average, and says so rather than reporting 0%.
    expect(t).toContain('Nothing matched');
  });

  it('a month never trawled says so and reports no measurement at all', () => {
    const t = text(render({ current: { state: 'not_trawled', month: '2026-08' } }));
    expect(t).toContain('No Instagram posts have been trawled for this month');
    // No "n of m" anywhere: that is the shape of every measurement this panel makes, and there
    // is nothing to measure. (The 85% in the method blurb is the THRESHOLD, not a reading — it
    // is a property of the method and is true whether or not there is data.)
    expect(t).not.toMatch(/\b\d+ of \d+\b/);
    expect(t).not.toContain('Nothing matched');   // not even the divergence stub
  });

  it('a trawled month with no captions says that, not 0% adoption', () => {
    const t = text(render({ current: { state: 'no_captions', month: '2026-08', published: 4 } }));
    expect(t).toContain('4 posts trawled, none with a caption');
  });

  it('a month with no plan behind it says that, not 0% adoption', () => {
    const t = text(render({ current: { state: 'no_plan', month: '2026-08', published: 12 } }));
    expect(t).toContain('12 captions published, but no Sprigly caption exists to compare them against');
  });

  it('when the current month has no answer, the last month that does is shown and labelled', () => {
    const t = text(render({
      current: { state: 'not_trawled', month: '2026-08' },
      latestMeasured: JULY,
    }));
    expect(t).toContain('No Instagram posts have been trawled');
    expect(t).toContain('Last complete month — July 2026');
    expect(t).toContain('10 of 36');
  });

  it('the last complete month is shown even when the current one has an answer', () => {
    // The current month is partial by definition — "0 of 1" on the 3rd is honest and useless.
    const t = text(render({
      current: { ...JULY, month: '2026-08', published: 1, matched: 0, adoption: 0, divergence: null },
      latestMeasured: JULY,
    }));
    expect(t).toContain('0 of 1');
    expect(t).toContain('Last complete month — July 2026');
    expect(t).toContain('10 of 36');
  });

  it('no fallback block when there is no earlier month to show', () => {
    expect(text(render({ latestMeasured: null }))).not.toContain('Last complete month');
  });
});

describe('the method is on the screen', () => {
  it('says the match is textual and why there is no join', () => {
    const t = text(render());
    expect(t).toContain('Instagram gives us no post id');
    expect(t).toContain('the match is on the WORDS');
    expect(t).toContain('85%');
  });

  it('says the figure is a floor', () => {
    const t = text(render());
    expect(t).toContain('Read it as a floor, not a measurement');
    expect(t).toContain('Meta Graph API');
  });

  it('states the size of the pool it compared against', () => {
    expect(text(render())).toContain('Compared against 80 planned posts');
  });

  it('says when planned posts were excluded, and why', () => {
    const t = text(render({ poolWithoutSpriglyText: 3 }));
    expect(t).toContain('3 excluded: the caption on file is the client’s own text, not ours');
  });

  it('says nothing about exclusions when there were none', () => {
    expect(text(render())).not.toContain('excluded');
  });
});

describe('the link through to the trend', () => {
  it('points at the channel it is describing', () => {
    expect(render()).toContain('href="/admin/clients/c1/health/instagram"');
  });

  it('names the channel in the header only when there is more than one', () => {
    expect(text(render({ showChannel: true }))).toContain('instagram');
    expect(text(render({ showChannel: false }))).not.toContain('instagram');
  });
});
