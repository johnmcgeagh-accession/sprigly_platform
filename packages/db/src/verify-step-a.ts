import { db, knowledgeTopics, knowledgeChunks, promptTemplates, sql } from './index.js';
import { and, eq, isNull } from 'drizzle-orm';

// 1. Tables
const _t = await db.select().from(knowledgeTopics).limit(1);
console.log('knowledge_topics table: OK');
const _c = await db.select().from(knowledgeChunks).limit(1);
console.log('knowledge_chunks table: OK');

// 2. vector extension
const ext = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
console.log('vector extension:', ext.length > 0 ? 'PRESENT' : 'MISSING');

// 3. HNSW index
const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_chunks_embedding'`;
console.log('HNSW index:', idx.length > 0 ? 'PRESENT' : 'MISSING');

// 4. Seeded prompt templates from 0023
const templates = await db
  .select({ stepName: promptTemplates.stepName })
  .from(promptTemplates)
  .where(and(isNull(promptTemplates.clientId), eq(promptTemplates.workflowId, 'sprigly-question-answerer')));
console.log('Seeded templates:', templates.map(t => t.stepName).join(', '));

// 5. Migration record count
const migs = await sql`SELECT COUNT(*) as cnt FROM drizzle.__drizzle_migrations`;
console.log('Total migration records:', migs[0]?.cnt);

await sql.end();
process.exit(0);
