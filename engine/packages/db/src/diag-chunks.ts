import { sql } from './client.js';

const rows = await sql`
  SELECT id, status, topic_id, source_type,
         left(content, 80) AS content_head,
         (embedding IS NOT NULL) AS has_embedding
  FROM knowledge_chunks
  WHERE client_id = '199678dd-d7d3-4e3b-91b8-8dd8150742d9'
  ORDER BY created_at
`;

console.log('Count:', rows.length);
for (const r of rows) console.log(JSON.stringify(r));

await sql.end();
process.exit(0);
