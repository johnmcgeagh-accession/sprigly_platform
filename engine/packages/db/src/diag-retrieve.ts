import { sql } from './client.js';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { retrieveChunks } from '@sprigly/knowledge';

// Use the exact question from the workflow_runs output to reproduce
// Also run with topicId=null to bypass the filter
const clientId = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';
const embeddingClient = createEmbeddingClientFromEnv();

// Check topic UUIDs in the knowledge_topics table
const topics = await sql`SELECT id, name FROM knowledge_topics WHERE client_id = ${clientId} ORDER BY name`;
console.log('\nKnowledge topics:');
for (const t of topics) console.log(`  ${t.name}: ${t.id}`);

// Check which topics actually have chunks
const topicCoverage = await sql`
  SELECT kt.name, kt.id, COUNT(kc.id) as chunk_count
  FROM knowledge_topics kt
  LEFT JOIN knowledge_chunks kc ON kc.topic_id = kt.id AND kc.client_id = ${clientId}
  WHERE kt.client_id = ${clientId}
  GROUP BY kt.id, kt.name
  ORDER BY kt.name
`;
console.log('\nTopic coverage (which topics have chunks):');
for (const t of topicCoverage) console.log(`  ${t.name}: ${t.chunk_count} chunks`);

// Grab the most recent workflow run to see what topicId was used
const runs = await sql`
  SELECT id, created_at,
         output->>'cleanQuestion' AS clean_question,
         output->>'topicId'      AS topic_id,
         output->>'outcome'      AS outcome,
         output->>'noChunksFound' AS no_chunks_found
  FROM workflow_runs
  WHERE workflow_id = 'sprigly-question-answerer'
    AND client_id = ${clientId}
  ORDER BY created_at DESC
  LIMIT 3
`;
console.log('\nRecent question-answerer runs:');
for (const r of runs) console.log(JSON.stringify(r, null, 2));

// Now run retrieveChunks with topicId=null (whole-bank) using the most recent clean question
const testQuestion = (runs[0]?.clean_question as string | null) ?? 'How much does Sprigly cost?';
console.log(`\nRunning retrieveChunks (topicId=null) for: "${testQuestion}"`);
const chunks = await retrieveChunks(
  { clientId, queryText: testQuestion, topicId: null, k: 6 },
  { embeddingClient },
);
console.log(`Retrieved ${chunks.length} chunks:`);
for (const c of chunks) console.log(`  id=${c.id} score=${c.score?.toFixed(4)} summary=${c.summary}`);

await sql.end();
process.exit(0);
