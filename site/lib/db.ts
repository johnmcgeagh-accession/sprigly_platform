import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const blogPostsTable = pgTable('blog_posts', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  body: text('body').notNull(),
  excerpt: text('excerpt'),
  category: text('category'),
  author: text('author'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').notNull(),
  faq: jsonb('faq').$type<Array<{ question: string; answer: string }>>().default([]).notNull(),
});

export type BlogPost = typeof blogPostsTable.$inferSelect;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return drizzle(postgres(url));
}

export const db = createDb();
