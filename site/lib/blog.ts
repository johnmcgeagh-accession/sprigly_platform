import { eq, desc } from 'drizzle-orm';
import { db, blogPostsTable } from './db';

export type { BlogPost } from './db';

export async function getAllPublishedPosts() {
  try {
    if (!db) return [];
    return await db
      .select()
      .from(blogPostsTable)
      .where(eq(blogPostsTable.status, 'published'))
      .orderBy(desc(blogPostsTable.createdAt));
  } catch {
    return [];
  }
}

export async function getPostBySlug(slug: string) {
  try {
    if (!db) return null;
    const rows = await db
      .select()
      .from(blogPostsTable)
      .where(eq(blogPostsTable.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export function extractMarkdownBody(rawBody: string): string {
  if (!rawBody) return '';
  const json = parsedBodyJson(rawBody);
  if (json && typeof json['body'] === 'string') return json['body'] as string;
  return rawBody;
}

function parsedBodyJson(rawBody: string): Record<string, unknown> | null {
  if (!rawBody) return null;
  // Strip opening fence (```json or ```) with or without a newline after it,
  // then strip the closing fence. Handles both ```json\n{...}\n``` and ```json{...}```.
  const stripped = rawBody.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  if (!stripped.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(stripped);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function extractFaq(
  rawBody: string,
  dbFaq?: Array<{ question: string; answer: string }>,
): Array<{ question: string; answer: string }> {
  if (dbFaq && dbFaq.length > 0) return dbFaq;
  const json = parsedBodyJson(rawBody);
  if (!json) return [];
  const faqRaw = json['faq'];
  if (!Array.isArray(faqRaw)) return [];
  return (faqRaw as unknown[]).filter(
    (item): item is { question: string; answer: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>)['question'] === 'string' &&
      typeof (item as Record<string, unknown>)['answer'] === 'string',
  );
}

export function formatDate(d: Date | string | null): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(d));
}
