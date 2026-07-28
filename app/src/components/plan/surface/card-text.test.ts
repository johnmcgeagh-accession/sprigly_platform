/**
 * card-text.test.ts — a card never says the same thing twice.
 *
 * There is no title column on a post, so a heading has to come from somewhere. The failure
 * this pins is the one that only appears when a surface shows a heading AND an excerpt: the
 * caption's first sentence rendered as the heading and then again as the first line under it,
 * which reads as a rendering fault rather than as design.
 */
import { describe, it, expect } from 'vitest';
import { cardText } from './card-text';

describe('when the assembler gave the slot a title', () => {
  it('uses it, and the caption excerpt starts from the top', () => {
    const t = cardText({ title: 'Wilderness candle relaunch — Launch', caption: 'Wilderness is back. Cedarwood and damp earth.' });
    expect(t.heading).toBe('Wilderness candle relaunch — Launch');
    expect(t.source).toBe('slot');
    expect(t.teaser).toBe('Wilderness is back. Cedarwood and damp earth.');
  });

  it('holds even for the deterministic fallback title the assembler writes', () => {
    const t = cardText({ title: 'Home & Space — Carousel', caption: 'A room that breathes.' });
    expect(t.heading).toBe('Home & Space — Carousel');
    expect(t.teaser).toBe('A room that breathes.');
  });
});

describe('when it did not', () => {
  it('the heading is the first sentence and the teaser picks up from the second', () => {
    const t = cardText({ title: null, caption: 'Wilderness is back. There is a particular quality to autumn light indoors.' });
    expect(t.heading).toBe('Wilderness is back.');
    expect(t.source).toBe('caption');
    expect(t.teaser).toBe('There is a particular quality to autumn light indoors.');
  });

  it('a one-sentence caption gets a heading and NO teaser — there is nothing else to show', () => {
    const t = cardText({ title: null, caption: 'A small moment, made deliberate.' });
    expect(t.heading).toBe('A small moment, made deliberate.');
    expect(t.teaser).toBe('');
  });

  it('keeps the whole remainder, not just the second sentence', () => {
    const t = cardText({ title: '', caption: 'One. Two. Three.' });
    expect(t.heading).toBe('One.');
    expect(t.teaser).toBe('Two. Three.');
  });

  it('caps a runaway first sentence rather than letting it become the card', () => {
    const long = `${'x'.repeat(200)}. and then more`;
    expect(cardText({ title: null, caption: long }).heading).toHaveLength(90);
  });
});

describe('nothing written yet', () => {
  it('an empty caption is Untitled with no teaser', () => {
    const t = cardText({ title: null, caption: '' });
    expect(t.heading).toBe('Untitled');
    expect(t.source).toBe('none');
    expect(t.teaser).toBe('');
  });

  it('the placeholder caption is not a caption', () => {
    // DRAFT_PLACEHOLDER_CAPTION starts "Draft idea." — showing it as a heading would make
    // every blank post read as a post called "Draft idea".
    const t = cardText({ title: null, caption: 'Draft idea. Tell Sprigly what this post should be about.' });
    expect(t.heading).toBe('Untitled');
    expect(t.teaser).toBe('');
  });

  it('a slot title still wins over an empty caption — the slot is real even when the words are not', () => {
    const t = cardText({ title: 'Everyday Ritual — Single post', caption: '' });
    expect(t.heading).toBe('Everyday Ritual — Single post');
    expect(t.source).toBe('slot');
    expect(t.teaser).toBe('');
  });
});
