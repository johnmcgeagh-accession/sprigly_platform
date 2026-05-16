import { randomUUID } from 'node:crypto';
import { db as _db, blogPosts } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import type { BlogPostOutput } from '@sprigly/workflows';

type Db = typeof _db;

async function findUniqueSlug(db: Db, clientId: string, baseSlug: string): Promise<string> {
  const existing = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(and(eq(blogPosts.clientId, clientId), eq(blogPosts.slug, baseSlug)))
    .limit(1);

  if (existing[0] === undefined) return baseSlug;

  for (let attempt = 2; attempt <= 100; attempt++) {
    const candidate = `${baseSlug}-${attempt}`;
    const row = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(and(eq(blogPosts.clientId, clientId), eq(blogPosts.slug, candidate)))
      .limit(1);
    if (row[0] === undefined) return candidate;
  }

  throw new Error(`Could not find unique slug for "${baseSlug}" after 100 attempts`);
}

export class DbSaveBlogPost implements Destination<unknown> {
  id = 'db-save-blog-post';

  constructor(private db: Db) {}

  requiresApproval(config: DestinationConfig): boolean {
    return config.requireApproval === true;
  }

  async deliver(output: unknown, event: IncomingEvent, _config: DestinationConfig, _ctx: DeliveryContext): Promise<DeliveryResult> {
    try {
      const post = output as BlogPostOutput;
      const slug = await findUniqueSlug(this.db, event.clientId, post.slug);
      const previewToken = randomUUID();
      const publishToken = randomUUID();

      const [row] = await this.db.insert(blogPosts).values({
        clientId: event.clientId,
        title: post.title,
        slug,
        body: post.body,
        excerpt: post.excerpt || null,
        metaDescription: post.metaDescription || null,
        targetKeyword: post.targetKeyword || null,
        category: post.category || null,
        author: post.author || null,
        status: 'draft',
        cta: post.cta || null,
        previewToken,
        publishToken,
        researchNotes: post.researchNotes || null,
        faq: post.faq as Array<Record<string, unknown>>,
      }).returning({ id: blogPosts.id });

      if (!row) return { success: false, error: 'Insert returned no row' };

      return { success: true, metadata: { blogPostId: row.id, slug, previewToken, publishToken } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
