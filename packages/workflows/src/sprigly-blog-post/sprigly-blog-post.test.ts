import { describe, it, expect, vi } from 'vitest';
import type { IncomingEvent, WorkflowContext, ClientConfig, ModelCompleteResult } from '@sprigly/engine';
import { parseBlogPostInput } from './parse-input.js';
import { generateSlug } from './slug.js';
import { spriglyBlogPostWorkflow } from './sprigly-blog-post.js';
import type { ResearchResponse, StructureResponse } from './types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeEvent = (subject: string): IncomingEvent => ({
  id: 'evt-1',
  clientId: 'client-1',
  source: 'email',
  sourceMetadata: { subject, from: 'john@example.com' },
  receivedAt: new Date(),
  content: { text: subject, structured: { subject } },
  reply: { channel: 'email', data: {} },
});

const mockResult = (content: string): ModelCompleteResult => ({
  content,
  inputTokens: 100,
  outputTokens: 200,
  modelId: 'claude-haiku',
  stopReason: 'end_turn',
});

const researchResponse: ResearchResponse = {
  targetKeyword: 'AI healthcare',
  angles: ['efficiency', 'cost savings'],
  faq: [{ question: 'What is AI?', answer: 'Artificial intelligence.' }],
  researchNotes: 'Key research notes.',
};

const structureResponse: StructureResponse = {
  title: 'AI Tools in Healthcare',
  excerpt: 'Short excerpt about AI.',
  metaDescription: 'Meta description for AI tools.',
  category: 'Technology',
  cta: 'Get started today',
};

const makeCtx = (): WorkflowContext => ({
  clientId: 'client-1',
  clientConfig: {
    id: 'cfg-1',
    clientId: 'client-1',
    brandVoice: 'Direct and professional.',
    signature: 'John',
    authorName: 'John McGeagh',
    settings: {},
  } satisfies ClientConfig,
  model: {
    complete: vi.fn()
      .mockResolvedValueOnce(mockResult(JSON.stringify(researchResponse)))
      .mockResolvedValueOnce(mockResult(JSON.stringify(structureResponse)))
      .mockResolvedValueOnce(mockResult('# AI Tools in Healthcare\n\nFull body content.')),
  },
  audit: {
    logModelCall: vi.fn().mockResolvedValue(undefined),
  },
  prompts: {
    resolve: vi.fn().mockResolvedValue('Write about: {{topic}}'),
  },
  eventId: 'evt-1',
  runId: 'run-1',
});

// ─── parseBlogPostInput ───────────────────────────────────────────────────────

describe('parseBlogPostInput', () => {
  it('extracts topic from "Blog: ..." subject', () => {
    const result = parseBlogPostInput(makeEvent('Blog: AI in Healthcare'));
    expect(result).toEqual({ topic: 'AI in Healthcare' });
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseBlogPostInput(makeEvent('blog: lowercase prefix'))).toEqual({ topic: 'lowercase prefix' });
    expect(parseBlogPostInput(makeEvent('BLOG: uppercase prefix'))).toEqual({ topic: 'uppercase prefix' });
  });

  it('trims whitespace around the topic', () => {
    expect(parseBlogPostInput(makeEvent('Blog:  extra spaces  '))).toEqual({ topic: 'extra spaces' });
  });

  it('returns null for empty topic after "Blog:"', () => {
    expect(parseBlogPostInput(makeEvent('Blog:'))).toBeNull();
  });

  it('returns null for whitespace-only topic', () => {
    expect(parseBlogPostInput(makeEvent('Blog:   '))).toBeNull();
  });

  it('returns null for non-blog prefix', () => {
    expect(parseBlogPostInput(makeEvent('Prospect: some brand'))).toBeNull();
  });

  it('returns null for empty subject', () => {
    expect(parseBlogPostInput(makeEvent(''))).toBeNull();
  });

  it('falls back to content.structured.subject when sourceMetadata has no subject', () => {
    const event: IncomingEvent = {
      ...makeEvent(''),
      sourceMetadata: {},
      content: { text: 'Blog: Fallback topic', structured: { subject: 'Blog: Fallback topic' } },
    };
    expect(parseBlogPostInput(event)).toEqual({ topic: 'Fallback topic' });
  });
});

// ─── generateSlug ────────────────────────────────────────────────────────────

describe('generateSlug', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(generateSlug('AI in Healthcare')).toBe('ai-in-healthcare');
  });

  it('strips special characters', () => {
    expect(generateSlug('AI: Tools & Automation!')).toBe('ai-tools-automation');
  });

  it('collapses multiple hyphens', () => {
    expect(generateSlug('multiple   spaces')).toBe('multiple-spaces');
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  leading and trailing  ')).toBe('leading-and-trailing');
  });

  it('passes through already-hyphenated slugs', () => {
    expect(generateSlug('already-hyphenated')).toBe('already-hyphenated');
  });
});

// ─── spriglyBlogPostWorkflow.parseInput ──────────────────────────────────────

describe('spriglyBlogPostWorkflow.parseInput', () => {
  it('delegates to parseBlogPostInput', () => {
    expect(spriglyBlogPostWorkflow.parseInput(makeEvent('Blog: My Topic'))).toEqual({ topic: 'My Topic' });
    expect(spriglyBlogPostWorkflow.parseInput(makeEvent('Not a blog'))).toBeNull();
  });
});

// ─── spriglyBlogPostWorkflow.run ─────────────────────────────────────────────

describe('spriglyBlogPostWorkflow.run', () => {
  it('makes exactly 3 model calls', async () => {
    const ctx = makeCtx();
    await spriglyBlogPostWorkflow.run({ topic: 'AI in Healthcare' }, ctx);
    expect(ctx.model.complete).toHaveBeenCalledTimes(3);
  });

  it('logs audit for each model call with correct action names', async () => {
    const ctx = makeCtx();
    await spriglyBlogPostWorkflow.run({ topic: 'AI in Healthcare' }, ctx);
    expect(ctx.audit.logModelCall).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(ctx.audit.logModelCall).mock.calls;
    expect(calls[0]?.[0].action).toBe('blog-research');
    expect(calls[1]?.[0].action).toBe('blog-structure');
    expect(calls[2]?.[0].action).toBe('blog-write');
  });

  it('resolves prompts for each step', async () => {
    const ctx = makeCtx();
    await spriglyBlogPostWorkflow.run({ topic: 'AI in Healthcare' }, ctx);
    expect(ctx.prompts.resolve).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(ctx.prompts.resolve).mock.calls;
    expect(calls[0]?.[2]).toBe('research');
    expect(calls[1]?.[2]).toBe('structure');
    expect(calls[2]?.[2]).toBe('write');
  });

  it('returns correct output shape', async () => {
    const ctx = makeCtx();
    const output = await spriglyBlogPostWorkflow.run({ topic: 'AI in Healthcare' }, ctx);
    expect(output.title).toBe('AI Tools in Healthcare');
    expect(output.slug).toBe('ai-tools-in-healthcare');
    expect(output.body).toContain('# AI Tools in Healthcare');
    expect(output.author).toBe('John McGeagh');
    expect(output.targetKeyword).toBe('AI healthcare');
    expect(output.category).toBe('Technology');
    expect(output.faq).toHaveLength(1);
    expect(output.faq[0]?.question).toBe('What is AI?');
    expect(output.topic).toBe('AI in Healthcare');
  });

  it('handles JSON inside code fences in model response', async () => {
    const ctx: WorkflowContext = {
      ...makeCtx(),
      model: {
        complete: vi.fn()
          .mockResolvedValueOnce(mockResult('```json\n' + JSON.stringify(researchResponse) + '\n```'))
          .mockResolvedValueOnce(mockResult('```json\n' + JSON.stringify(structureResponse) + '\n```'))
          .mockResolvedValueOnce(mockResult('# Title\n\nBody.')),
      },
    };
    const output = await spriglyBlogPostWorkflow.run({ topic: 'AI in Healthcare' }, ctx);
    expect(output.targetKeyword).toBe('AI healthcare');
    expect(output.title).toBe('AI Tools in Healthcare');
  });
});
