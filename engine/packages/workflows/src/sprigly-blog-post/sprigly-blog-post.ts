import type { Workflow, WorkflowContext, IncomingEvent } from '@sprigly/engine';
import type { BlogPostInput, BlogPostOutput, ResearchResponse, StructureResponse } from './types.js';
import { parseBlogPostInput } from './parse-input.js';
import { generateSlug } from './slug.js';

function extractJson(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (match?.[1] ?? text).trim();
  return JSON.parse(raw);
}

function getModelId(ctx: WorkflowContext): string {
  return (ctx.clientConfig.settings['model'] as string | undefined) ?? 'haiku';
}

function buildSystemPrompt(ctx: WorkflowContext): string {
  return [
    `You are a professional content writer for ${ctx.clientConfig.authorName}.`,
    `Brand voice: ${ctx.clientConfig.brandVoice}`,
    'Always respond with valid JSON when asked for structured data.',
  ].join('\n');
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export const spriglyBlogPostWorkflow: Workflow<BlogPostInput, BlogPostOutput> = {
  id: 'sprigly-blog-post',
  defaultDestinations: [{
    destinationId: 'db-save-blog-post',
    requireApproval: false,
    settings: {},
  }],

  parseInput(event: IncomingEvent): BlogPostInput | null {
    return parseBlogPostInput(event);
  },

  async run(input: BlogPostInput, ctx: WorkflowContext): Promise<BlogPostOutput> {
    const modelId = getModelId(ctx);
    const system = buildSystemPrompt(ctx);

    // ── Call 1: Research ─────────────────────────────────────────────────────
    const researchPrompt = await ctx.prompts.resolve(ctx.clientId, 'sprigly-blog-post', 'research');
    const researchResult = await ctx.model.complete({
      model: modelId,
      system,
      messages: [{ role: 'user', content: fillTemplate(researchPrompt, { topic: input.topic }) }],
      maxTokens: 1000,
    });
    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId: ctx.eventId,
      runId: ctx.runId,
      modelId: researchResult.modelId,
      inputTokens: researchResult.inputTokens,
      outputTokens: researchResult.outputTokens,
      action: 'blog-research',
    });
    const research = extractJson(researchResult.content) as ResearchResponse;

    // ── Call 2: Structure ────────────────────────────────────────────────────
    const structurePrompt = await ctx.prompts.resolve(ctx.clientId, 'sprigly-blog-post', 'structure');
    const structureResult = await ctx.model.complete({
      model: modelId,
      system,
      messages: [{
        role: 'user',
        content: fillTemplate(structurePrompt, {
          topic: input.topic,
          research: JSON.stringify(research),
        }),
      }],
      maxTokens: 500,
    });
    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId: ctx.eventId,
      runId: ctx.runId,
      modelId: structureResult.modelId,
      inputTokens: structureResult.inputTokens,
      outputTokens: structureResult.outputTokens,
      action: 'blog-structure',
    });
    const structure = extractJson(structureResult.content) as StructureResponse;

    // ── Call 3: Write ────────────────────────────────────────────────────────
    const writePrompt = await ctx.prompts.resolve(ctx.clientId, 'sprigly-blog-post', 'write');
    const writeResult = await ctx.model.complete({
      model: modelId,
      system,
      messages: [{
        role: 'user',
        content: fillTemplate(writePrompt, {
          topic: input.topic,
          research: JSON.stringify(research),
          title: structure.title ?? input.topic,
          keyword: research.targetKeyword ?? '',
        }),
      }],
      maxTokens: 3000,
    });
    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId: ctx.eventId,
      runId: ctx.runId,
      modelId: writeResult.modelId,
      inputTokens: writeResult.inputTokens,
      outputTokens: writeResult.outputTokens,
      action: 'blog-write',
    });

    const title = structure.title ?? input.topic;

    return {
      title,
      slug: generateSlug(title),
      body: writeResult.content,
      excerpt: structure.excerpt ?? '',
      metaDescription: structure.metaDescription ?? '',
      targetKeyword: research.targetKeyword ?? '',
      category: structure.category ?? 'General',
      author: ctx.clientConfig.authorName,
      cta: structure.cta ?? '',
      researchNotes: research.researchNotes ?? JSON.stringify(research),
      faq: research.faq ?? [],
      topic: input.topic,
    };
  },
};
