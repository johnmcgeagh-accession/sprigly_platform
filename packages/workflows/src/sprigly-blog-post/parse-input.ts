import type { IncomingEvent } from '@sprigly/engine';
import type { BlogPostInput } from './types.js';

export function parseBlogPostInput(event: IncomingEvent): BlogPostInput | null {
  const subject =
    (event.sourceMetadata['subject'] as string | undefined) ??
    (event.content.structured?.['subject'] as string | undefined) ??
    '';

  const prefix = 'blog:';
  if (!subject.toLowerCase().startsWith(prefix)) return null;

  const topic = subject.slice(prefix.length).trim();
  if (topic === '') return null;

  return { topic };
}
