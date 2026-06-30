import type { Workflow, WorkflowContext, IncomingEvent, KnowledgeTopicSummary } from '@sprigly/engine';
import { retrieveChunks } from '@sprigly/knowledge';
import type { QuestionAnswererInput, QuestionAnswererOutput } from './types.js';
import { parseQuestionAnswererInput } from './parse-input.js';

function getStepModel(ctx: WorkflowContext, stepName: string): string {
  const stepModels = ctx.clientConfig.settings['stepModels'] as Record<string, Record<string, string>> | undefined;
  return stepModels?.['sprigly-question-answerer']?.[stepName] ?? 'sonnet';
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

function formatTopics(topics: KnowledgeTopicSummary[]): string {
  if (topics.length === 0) return '';
  return topics
    .map((t) => `- id: ${t.id}, name: "${t.name}"${t.description != null ? `, description: "${t.description}"` : ''}`)
    .join('\n');
}

export const spriglyQuestionAnswererWorkflow: Workflow<QuestionAnswererInput, QuestionAnswererOutput> = {
  id: 'sprigly-question-answerer',

  defaultDestinations: [
    { destinationId: 'db-save-output', requireApproval: false, settings: {} },
  ],

  parseInput(event: IncomingEvent): QuestionAnswererInput | null {
    return parseQuestionAnswererInput(event);
  },

  async run(input: QuestionAnswererInput, ctx: WorkflowContext): Promise<QuestionAnswererOutput> {
    if (ctx.embeddingClient === undefined) {
      throw new Error(
        'sprigly-question-answerer: embeddingClient not in WorkflowContext ' +
        '— pass an EmbeddingClient to WorkflowRunner',
      );
    }

    const topics = ctx.knowledgeTopics ?? [];
    const validTopicIds = new Set(topics.map((t) => t.id));

    let hasTriage = typeof input.triageTopicId === 'string' && input.triageTopicId !== '';
    if (hasTriage && !validTopicIds.has(input.triageTopicId!)) {
      console.warn(
        `[question-answerer] forwarded triageTopicId=${input.triageTopicId} not in client knowledge_topics (eventId=${ctx.eventId}) — discarding, will reclassify`,
      );
      hasTriage = false;
    }

    // ── Step 1: Reformulate + classify ─────────────────────────────────────────
    // If Triage already produced a topicId for this email we skip classification
    // and only reformulate, so we don't run a second AI classifier for the same data.
    const reformulateTemplate = await ctx.prompts.resolve(
      ctx.clientId, 'sprigly-question-answerer', 'reformulate',
    );
    const reformulateResult = await ctx.model.complete({
      model: getStepModel(ctx, 'reformulate'),
      messages: [{
        role: 'user',
        content: fillTemplate(reformulateTemplate, {
          subject:       input.subject,
          body:          input.body,
          topics:        formatTopics(topics),
          triageTopicId: input.triageTopicId ?? '',
          skipClassify:  hasTriage ? 'true' : 'false',
        }),
      }],
      maxTokens: 500,
    });

    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId:  ctx.eventId,
      runId:    ctx.runId,
      modelId:  reformulateResult.modelId,
      inputTokens:  reformulateResult.inputTokens,
      outputTokens: reformulateResult.outputTokens,
      action: 'question-answerer-reformulate',
    });

    let cleanQuestion: string;
    let topicId: string | null;
    try {
      const parsed = extractJson(reformulateResult.content) as {
        cleanQuestion?: unknown;
        topicId?: unknown;
      };
      cleanQuestion = typeof parsed.cleanQuestion === 'string'
        ? parsed.cleanQuestion
        : input.body.slice(0, 300);
      // Honour triage topicId over the model's own classification.
      topicId = hasTriage
        ? input.triageTopicId!
        : (typeof parsed.topicId === 'string' ? parsed.topicId : null);
    } catch {
      cleanQuestion = input.body.slice(0, 300);
      topicId = input.triageTopicId ?? null;
    }

    // ── Step 2: Retrieve ────────────────────────────────────────────────────────
    // Precision path: topic-filtered first. If the topic has no chunks yet,
    // fall back to whole-bank search once before giving up — so a partial
    // knowledge bank doesn't block questions the bank can actually answer.
    // The retrievalPath log line tracks how often the fallback fires; if it's
    // the majority path, the topic filter is earning its keep less than it
    // costs and is worth revisiting.
    let chunks = await retrieveChunks(
      { clientId: ctx.clientId, queryText: cleanQuestion, topicId, k: 6 },
      { embeddingClient: ctx.embeddingClient },
    );

    let retrievalPath: 'topic-filtered' | 'whole-bank-fallback' | 'zero-chunks';

    if (chunks.length > 0) {
      retrievalPath = 'topic-filtered';
    } else if (topicId !== null) {
      chunks = await retrieveChunks(
        { clientId: ctx.clientId, queryText: cleanQuestion, topicId: null, k: 6 },
        { embeddingClient: ctx.embeddingClient },
      );
      retrievalPath = chunks.length > 0 ? 'whole-bank-fallback' : 'zero-chunks';
    } else {
      retrievalPath = 'zero-chunks';
    }

    console.log(
      `[question-answerer] retrieve path=${retrievalPath} topicId=${topicId ?? 'null'} ` +
      `chunks=${chunks.length} eventId=${ctx.eventId}`,
    );

    // ── Zero-chunks branch ──────────────────────────────────────────────────────
    // Do NOT compose a guessed answer. Draft a holding reply so a human can follow up.
    if (chunks.length === 0) {
      const holdingText = [
        'Thank you for your message.',
        '',
        "We want to make sure you get the right answer, so we'll have someone follow up shortly.",
        '',
        ctx.clientConfig.signature,
      ].filter(Boolean).join('\n');

      return {
        outcome:        'needs_human',
        cleanQuestion,
        topicId,
        chunkIds:       [],
        draftText:      holdingText,
        noChunksFound:  true,
        from:           input.from,
        subject:        input.subject,
        ...(input.threadId && { threadId: input.threadId }),
      };
    }

    // ── Step 3: Compose ─────────────────────────────────────────────────────────
    const composeTemplate = await ctx.prompts.resolve(
      ctx.clientId, 'sprigly-question-answerer', 'compose',
    );
    const chunksText = chunks
      .map((c, i) => `[${i + 1}]${c.summary ? ` ${c.summary}\n` : '\n'}${c.content}`)
      .join('\n\n---\n\n');

    const composeSystem = fillTemplate(composeTemplate, {
      brandVoice: ctx.clientConfig.brandVoice,
      signature:  ctx.clientConfig.signature,
      authorName: ctx.clientConfig.authorName,
      chunks:     chunksText,
    });

    const composeResult = await ctx.model.complete({
      model:   getStepModel(ctx, 'compose'),
      system:  composeSystem,
      messages: [{ role: 'user', content: cleanQuestion }],
      maxTokens: 1500,
    });

    const chunkIds = chunks.map((c) => c.id);

    await ctx.audit.logModelCall({
      clientId: ctx.clientId,
      eventId:  ctx.eventId,
      runId:    ctx.runId,
      modelId:  composeResult.modelId,
      inputTokens:  composeResult.inputTokens,
      outputTokens: composeResult.outputTokens,
      action: 'question-answerer-compose',
      metadata: { topicId, chunkIds, chunkCount: chunks.length },
    });

    return {
      outcome:       'needs_human',
      cleanQuestion,
      topicId,
      chunkIds,
      draftText:     composeResult.content,
      noChunksFound: false,
      from:          input.from,
      subject:       input.subject,
      ...(input.threadId && { threadId: input.threadId }),
    };
  },
};
