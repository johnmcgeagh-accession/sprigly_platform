/**
 * deliverable.test.ts — a deliverable contains the deliverable, and nothing else.
 *
 * The leaked shape is reconstructed from the round-two evidence (register deliberation,
 * word-count arithmetic, "Actually re-reading…", then the script after a `---` marker) — the
 * live uat row is not in the repo, so this fixture reproduces its structure faithfully. Both
 * the extraction and the gate are pure, so this needs no model call.
 */
import { describe, it, expect } from 'vitest';
import { extractDeliverable, extractSection, hasDeliberativeMarkers } from './deliverable.js';

// The clean deliverable that was buried after the reasoning.
const CLEAN_SCRIPT = [
  'HOOK: Our factory closes for summer — here\'s what that means for you.',
  'BEAT 1 (0–5s) — Sally to camera, holding the last drop. (medium shot)',
  'BEAT 2 (5–20s) — folded stock at the Portugal studio. (b-roll)',
  'CTA: Pre-order now, and let me know in the comments what you want restocked.',
].join('\n');

// The stored row: chain-of-thought, then a `---` marker, then the script.
const LEAKED = [
  'Let me think about the register here — the client voice is warm and plain, so I\'ll keep it conversational.',
  'Target is 30s ≈ 66 words at 2.2 words/second. Let me count as I go.',
  'Actually, re-reading the caption, the hook is about the factory shutdown, so beat 1 sets that up (~12 words, leaving ~54).',
  'Per the rules the hook must be used verbatim, so I\'ll use it as instructed even though it doesn\'t match the arc perfectly.',
  '',
  '---',
  CLEAN_SCRIPT,
].join('\n');

describe('extractDeliverable — the leaked uat shape', () => {
  it('yields ONLY the post-marker script, discarding the reasoning', () => {
    const out = extractDeliverable(LEAKED, 'SCRIPT');
    expect(out).toBe(CLEAN_SCRIPT);
    expect(out).not.toContain('Actually');
    expect(out).not.toContain('66 words');
    expect(out).not.toContain('Per the rules');
  });

  it('prefers an explicit ===SCRIPT=== section over the --- fallback', () => {
    const raw = `Some reasoning about the budget.\n\n===SCRIPT===\n${CLEAN_SCRIPT}`;
    expect(extractDeliverable(raw, 'SCRIPT')).toBe(CLEAN_SCRIPT);
  });

  it('passes a clean, contract-free response through unchanged', () => {
    expect(extractDeliverable(CLEAN_SCRIPT, 'SCRIPT')).toBe(CLEAN_SCRIPT);
  });

  it('reads named sections independently (combined hook + script)', () => {
    const raw = `thinking...\n===HOOK===\nOur factory closes for summer.\n===SCRIPT===\n${CLEAN_SCRIPT}`;
    expect(extractSection(raw, 'HOOK')).toBe('Our factory closes for summer.');
    expect(extractSection(raw, 'SCRIPT')).toBe(CLEAN_SCRIPT);
  });
});

describe('hasDeliberativeMarkers — the gate', () => {
  it('flags the raw leaked transcript', () => {
    expect(hasDeliberativeMarkers(LEAKED)).toBe(true);
  });

  it('passes the clean script — including a legitimate "let me know in the comments"', () => {
    expect(hasDeliberativeMarkers(CLEAN_SCRIPT)).toBe(false);
    expect(hasDeliberativeMarkers('CTA: let me know what you think!')).toBe(false);
  });

  it('catches reasoning that bled INTO the deliverable (a contaminated store attempt)', () => {
    const contaminated = `HOOK: The navy edit.\nBEAT 1 — Actually, let me recount: that\'s ≈40 words, over budget.\nCTA: Shop now.`;
    // extraction cannot save this — the reasoning is inside a beat, past every marker
    const out = extractDeliverable(`===SCRIPT===\n${contaminated}`, 'SCRIPT');
    expect(hasDeliberativeMarkers(out)).toBe(true);
  });

  it('catches the specific fingerprints', () => {
    for (const bad of [
      'Actually re-reading the brief, I think...',
      'let me reconsider the length',
      'that is ≈ 66 words',
      'word count is over budget',
      'per the rules the hook is verbatim',
      'I\'ll use it verbatim as instructed',
      'the hook doesn\'t match the arc at all',
    ]) expect(hasDeliberativeMarkers(bad)).toBe(true);
  });
});
