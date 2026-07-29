/**
 * format-change.test.ts — the sentence, pinned to what the mutation actually does.
 *
 * The point of testing a copy helper is that copy is where a lie hides. `patchPost` writes the
 * `format` column and touches nothing else; if that ever changes, these cases fail rather than
 * the note quietly becoming false on a live client's screen.
 */
import { describe, it, expect } from 'vitest';
import { formatChangeNote, formatNeedsHook, formatNeedsScript } from './format-change';

describe('which formats carry what', () => {
  it('matches the endpoints: hooks are reels and carousels, scripts are reels', () => {
    expect(formatNeedsHook('reel')).toBe(true);
    expect(formatNeedsHook('carousel')).toBe(true);
    expect(formatNeedsHook('single')).toBe(false);

    expect(formatNeedsScript('reel')).toBe(true);
    expect(formatNeedsScript('carousel')).toBe(false);
    expect(formatNeedsScript('single')).toBe(false);
  });
});

describe('the note', () => {
  it('is EMPTY when there is nothing worth saying', () => {
    // A carousel with a hook and no script: it has what it needs and lost nothing.
    expect(formatChangeNote('carousel', { hook: true, script: false })).toBe('');
  });

  it('never claims a deletion, because there is none', () => {
    const note = formatChangeNote('single', { hook: true, script: true });
    expect(note).toContain('still saved');
    expect(note).not.toMatch(/remov|delet|clear|lost/i);
  });

  it('says "it" for one stranded field and "them" for two', () => {
    expect(formatChangeNote('single', { hook: true, script: false })).toContain('doesn’t use it');
    expect(formatChangeNote('single', { hook: true, script: true })).toContain('doesn’t use them');
  });

  it('names what the new format still needs, and where to write it', () => {
    const note = formatChangeNote('reel', { hook: false, script: false });
    expect(note).toContain('A reel needs a hook and a script');
    expect(note).toContain('hook and script tabs');
  });

  it('carries both halves when a change both strands and requires', () => {
    // Carousel with a hook → reel: the hook survives and is still used, the script is missing.
    const note = formatChangeNote('reel', { hook: true, script: false });
    expect(note).toContain('A reel needs a script');
    expect(note).not.toContain('still saved');
  });

  it('says nothing about a format it does not know', () => {
    expect(formatChangeNote('email', { hook: false, script: false })).toBe('');
  });
});
