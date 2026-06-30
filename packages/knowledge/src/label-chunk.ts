import type { ModelClient } from '@sprigly/model-client';
import type { KnowledgeTopic } from '@sprigly/db';
import type { LabelResult } from './types.js';

export async function labelChunk(
  content: string,
  topics: KnowledgeTopic[],
  model: ModelClient,
  modelName: string,
): Promise<LabelResult> {
  if (topics.length === 0) {
    return { topicId: null, keywords: [], summary: '' };
  }

  const topicList = topics
    .map((t) => `- id: ${t.id}, name: "${t.name}"${t.description != null ? `, description: "${t.description}"` : ''}`)
    .join('\n');

  const result = await model.complete({
    model: modelName,
    messages: [
      {
        role: 'user',
        content: [
          'Classify the following knowledge chunk and extract metadata.',
          '',
          'Available topics:',
          topicList,
          '',
          'Chunk content:',
          content,
          '',
          'Return JSON with exactly this shape (no other text):',
          '{ "topicId": "<uuid from above list, or null if none fit well>", "keywords": ["<3-7 relevant terms>"], "summary": "<one sentence under 120 chars>" }',
          '',
          'Rules: only choose a topicId from the provided list. If none fit, use null.',
        ].join('\n'),
      },
    ],
    maxTokens: 300,
  });

  const raw = result.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { topicId: null, keywords: [], summary: '' };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      topicId?: string | null;
      keywords?: unknown;
      summary?: unknown;
    };
    return {
      topicId: typeof parsed.topicId === 'string' ? parsed.topicId : null,
      keywords: Array.isArray(parsed.keywords)
        ? (parsed.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
        : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch {
    return { topicId: null, keywords: [], summary: '' };
  }
}
