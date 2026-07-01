import { describe, it, expect, vi } from 'vitest';

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────
// The pure functions under test are in voice-consumer.ts, but the module
// also imports @sprigly/db (which throws ZodError if DATABASE_URL is absent)
// and other side-effectful packages. Mock them all so only the pure exports
// are exercised — no real DB or Drive connections in unit tests.

vi.mock('bullmq', () => ({ Worker: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock('@sprigly/db', () => ({
  db: {},
  voiceEdits: Symbol('voiceEdits'),
  voiceIngestionRuns: Symbol('voiceIngestionRuns'),
  voiceSnapshots: Symbol('voiceSnapshots'),
  clientChannels: Symbol('clientChannels'),
  processedExternalIds: Symbol('processedExternalIds'),
}));
vi.mock('@sprigly/oauth-tokens', () => ({ getTokens: vi.fn(), storeTokens: vi.fn() }));
vi.mock('@sprigly/sources', () => ({ DriveApiClient: vi.fn() }));
vi.mock('@sprigly/prompts', () => ({ DbPromptResolver: vi.fn() }));
vi.mock('@sprigly/model-client', () => ({}));
vi.mock('@sprigly/audit', () => ({}));

import {
  fillTemplate,
  MERGE_PROMPT_SEED,
  MERGE_PROMPT_VARS_KEYS,
  replaceChannelBlock,
  formatEditSummary,
} from './voice-consumer.js';

// ─── fillTemplate coverage ────────────────────────────────────────────────────
// Every {{var}} in the seed prompt MUST have a matching key in MERGE_PROMPT_VARS_KEYS.
// Silent empty-string substitution (the ?? '' fallback in fillTemplate) is the footgun:
// a misspelled or missing key produces no error and an empty string in the prompt.
// This test catches that at the source (the seed) rather than at runtime.

describe('fillTemplate coverage', () => {
  it('every {{var}} in MERGE_PROMPT_SEED has a matching entry in MERGE_PROMPT_VARS_KEYS', () => {
    const placeholders = new Set<string>();
    for (const match of MERGE_PROMPT_SEED.matchAll(/\{\{(\w+)\}\}/g)) {
      placeholders.add(match[1]!);
    }

    const knownKeys = new Set<string>(MERGE_PROMPT_VARS_KEYS);

    const uncovered = [...placeholders].filter((p) => !knownKeys.has(p));
    expect(uncovered, `Seed prompt contains {{var}} not in MERGE_PROMPT_VARS_KEYS: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('every key in MERGE_PROMPT_VARS_KEYS appears at least once in MERGE_PROMPT_SEED', () => {
    // Catch unused keys that were added to MERGE_PROMPT_VARS_KEYS but forgotten in the prompt
    for (const key of MERGE_PROMPT_VARS_KEYS) {
      expect(MERGE_PROMPT_SEED, `Key "${key}" in MERGE_PROMPT_VARS_KEYS is not used in the seed prompt`).toContain(`{{${key}}}`);
    }
  });

  it('fillTemplate replaces all known vars', () => {
    const template = 'Hello {{channelTitle}}: {{currentVoiceProfile}} — {{editSummary}}';
    const result = fillTemplate(template, {
      channelTitle: 'Instagram',
      currentVoiceProfile: 'existing profile',
      editSummary: 'edit 1',
    });
    expect(result).toBe('Hello Instagram: existing profile — edit 1');
  });

  it('fillTemplate substitutes empty string for missing keys (documents the footgun)', () => {
    const result = fillTemplate('Hello {{missing}}', { other: 'value' });
    expect(result).toBe('Hello ');
  });
});

// ─── replaceChannelBlock ──────────────────────────────────────────────────────

describe('replaceChannelBlock', () => {
  const instagramBlock = `## Instagram — Voice Profile

### Tone
Casual and direct.

### Vocabulary
**Use:** short sentences
**Avoid:** jargon`;

  const linkedinBlock = `## Linkedin — Voice Profile

### Tone
Professional.`;

  it('replaces an existing channel block, preserving other channels', () => {
    const voiceMd = [instagramBlock, linkedinBlock].join('\n\n');
    const updated  = `## Instagram — Voice Profile\n\n### Tone\nNew tone.`;

    const result = replaceChannelBlock(voiceMd, 'Instagram', updated);

    expect(result).toContain('## Instagram — Voice Profile');
    expect(result).toContain('New tone.');
    expect(result).not.toContain('Casual and direct.');
    expect(result).toContain('## Linkedin — Voice Profile');
  });

  it('appends a new channel block when the channel is not present', () => {
    const result = replaceChannelBlock(instagramBlock, 'Linkedin', linkedinBlock);

    expect(result).toContain('## Instagram — Voice Profile');
    expect(result).toContain('## Linkedin — Voice Profile');
  });

  it('handles empty voice.md (first ingest)', () => {
    const newBlock = '## Instagram — Voice Profile\n\n### Tone\nWarm.';
    const result   = replaceChannelBlock('', 'Instagram', newBlock);

    expect(result.trim()).toBe(newBlock);
  });

  it('result always ends with a newline', () => {
    const result = replaceChannelBlock('', 'Instagram', '## Instagram — Voice Profile\n\nTone.');
    expect(result).toMatch(/\n$/);
  });
});

// ─── formatEditSummary ────────────────────────────────────────────────────────

describe('formatEditSummary', () => {
  it('formats edits with title, draft, amendment, and notes', () => {
    const result = formatEditSummary([{
      postIndex:      1,
      postTitle:      'Why design matters',
      date:           '5 Jul',
      spriglyDraft:   'Design is important for business.',
      contactAmended: 'Good design is good business.',
      notes:          'Make it punchier',
    }]);

    expect(result).toContain('Edit 1: Why design matters (5 Jul)');
    expect(result).toContain('Sprigly draft:     Design is important for business.');
    expect(result).toContain('Client amended to: Good design is good business.');
    expect(result).toContain('Client notes:      Make it punchier');
  });

  it('omits null fields', () => {
    const result = formatEditSummary([{
      postIndex: 2, postTitle: null, date: null,
      spriglyDraft: 'Draft text.', contactAmended: 'Better text.', notes: null,
    }]);

    expect(result).toContain('Edit 2');
    expect(result).not.toContain('(');   // no date
    expect(result).not.toContain('Client notes');
  });

  it('separates multiple edits with blank lines', () => {
    const result = formatEditSummary([
      { postIndex: 1, postTitle: 'A', date: null, spriglyDraft: 'x', contactAmended: 'y', notes: null },
      { postIndex: 2, postTitle: 'B', date: null, spriglyDraft: 'p', contactAmended: 'q', notes: null },
    ]);
    expect(result).toContain('\n\n');
  });
});
