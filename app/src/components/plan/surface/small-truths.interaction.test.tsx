/**
 * @vitest-environment jsdom
 *
 * small-truths.interaction.test.tsx — F7's four fixes, each pinned where it broke.
 *
 *   a) the month summary's rows carry the POST'S REAL format — rowsFromPosts never set
 *      `format`, so every format-led row fell through `?? 'single'` and drew the image tile
 *      for reels and carousels alike.
 *   b) DELETED (F4). The activity meter is gone — see `voice-sheet.interaction`, which now
 *      pins its absence and the transcript landing in the field instead.
 *   c) theme-color follows the sheet — the scrim dims the app while the status-bar band
 *      stayed bright canvas; the meta now blends to the scrim tone while a sheet is up and
 *      restores on the last close.
 *   d) a digest answer renders as structured lines — markdown markers stripped, one block
 *      per line, day headers weighted — instead of a text node full of asterisks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { rowsFromPosts, MonthDaySummary } from './rows';
import { Feedback } from './Feedback';
import { Sheet } from './Sheet';
import { agentLines, stripMarkdown } from './agent-prose';
import { blendHex } from './theme-color';
import type { PlanPost } from '@/lib/types';

const post = (over: Partial<PlanPost> = {}): PlanPost => ({
  id: 'p1', cycleId: 'c', clientId: 'cl', channel: 'instagram', date: '2026-10-02',
  format: 'reel', pillar: 'Style', caption: 'Words', status: 'planned', reviewState: null, steps: [],
  ...over,
});

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(cleanup);

describe('a) the row carries the post’s real format', () => {
  it('rowsFromPosts derives format from the post — the same source the detail sheet reads', () => {
    const rows = rowsFromPosts([post({ format: 'reel' }), post({ id: 'p2', format: 'carousel' })], () => '');
    expect(rows.map((r) => r.format)).toEqual(['reel', 'carousel']);
  });

  it('the month summary draws each post’s own tile, not the image tile three times', () => {
    const items = rowsFromPosts(
      [post({ id: 'a', format: 'reel' }), post({ id: 'b', format: 'carousel' }), post({ id: 'c', format: 'single' })],
      () => '',
    );
    render(<MonthDaySummary date="2026-10-02" items={items} onOpen={() => {}} />);
    const tiles = screen.getAllByTestId('format-tile').map((el) => el.getAttribute('data-format'));
    expect(tiles).toEqual(['reel', 'carousel', 'single']);
  });
});

describe('c) theme-color follows the sheet', () => {
  const meta = () => document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
  beforeEach(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const m = document.createElement('meta');
    m.name = 'theme-color'; m.content = '#F5F1EA';
    document.head.appendChild(m);
  });

  it('blendHex mixes the canvas toward chrome-deep at the scrim’s alpha', () => {
    // #FFFFFF toward rgb(30,41,59) at .34 → each channel 255*(1-.34) + c*.34, rounded
    // (the red channel lands on 178.49999… in floating point, so 0xb2).
    expect(blendHex('#FFFFFF', [30, 41, 59], 0.34)).toBe('#b2b6bc');
    expect(blendHex('not-a-hex', [30, 41, 59], 0.34)).toBe('not-a-hex');   // refuses to guess
  });

  it('opening a sheet dims the band; closing restores what the server wrote', () => {
    const before = meta().content;
    const { unmount } = render(
      <Sheet open label="Test" testid="tc-sheet" onClose={() => {}}><div /></Sheet>,
    );
    expect(meta().content).not.toBe(before);
    unmount();
    expect(meta().content).toBe(before);
  });

  it('stacked sheets: the first close does NOT restore the band under the one still open', () => {
    const before = meta().content;
    const a = render(<Sheet open label="A" testid="tc-a" onClose={() => {}}><div /></Sheet>);
    const dimmed = meta().content;
    const b = render(<Sheet open label="B" testid="tc-b" onClose={() => {}} layer={1}><div /></Sheet>);
    b.unmount();
    expect(meta().content).toBe(dimmed);   // still one sheet up
    a.unmount();
    expect(meta().content).toBe(before);
  });
});

describe('d) a digest answer renders as structured lines', () => {
  const ANSWER = [
    '**Friday 14 August:**',
    '* Reel — Weekend Style Guide',
    '* Single — The restock tease',
    '**Saturday 15 August:**',
    '- Carousel — Five ways to style the linen dress',
  ].join('\n');

  it('stripMarkdown removes the markers and nothing else', () => {
    expect(stripMarkdown('* Reel — **Weekend** `Style` Guide')).toBe('Reel — Weekend Style Guide');
  });

  it('agentLines keeps the structure: a line per post, day headers marked', () => {
    const lines = agentLines(ANSWER);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toEqual({ text: 'Friday 14 August:', header: true });
    expect(lines[1]).toEqual({ text: 'Reel — Weekend Style Guide', header: false });
    expect(lines[3]!.header).toBe(true);
  });

  it('the feedback slot renders blocks, and no asterisk survives to the screen', () => {
    render(<Feedback frame="mobile" undo={null} onDismiss={() => {}} agent={ANSWER} />);
    const said = screen.getByTestId('feedback-agent').textContent ?? '';
    expect(said).not.toContain('*');
    expect(said).toContain('Weekend Style Guide');
    expect(screen.getAllByTestId('agent-line')).toHaveLength(5);
  });

  it('a one-line reply stays plain prose — structure is for structure', () => {
    render(<Feedback frame="mobile" undo={null} onDismiss={() => {}} agent="You have 12 posts planned across August." />);
    expect(screen.queryByTestId('agent-line')).toBeNull();
    expect(screen.getByTestId('feedback-agent').textContent).toContain('12 posts planned');
  });
});
