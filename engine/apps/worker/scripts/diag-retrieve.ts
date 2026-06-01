import { sql } from '@sprigly/db';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { retrieveChunks } from '@sprigly/knowledge';

const clientId = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';
const embeddingClient = createEmbeddingClientFromEnv();

const topics = await sql`SELECT id, name FROM knowledge_topics WHERE client_id = ${clientId} ORDER BY name`;
console.log('\nKnowledge topics:');
for (const t of topics) console.log(`  ${t.name}: ${t.id}`);

const topicCoverage = await sql`
  SELECT kt.name, kt.id, COUNT(kc.id) as chunk_count
  FROM knowledge_topics kt
  LEFT JOIN knowledge_chunks kc ON kc.topic_id = kt.id AND kc.client_id = ${clientId}
  WHERE kt.client_id = ${clientId}
  GROUP BY kt.id, kt.name
  ORDER BY kt.name
`;
console.log('\nTopic coverage:');
for (const t of topicCoverage) console.log(`  ${t.name}: ${t.chunk_count} chunks`);

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

const testQuestion = (runs[0]?.clean_question as string | null) ?? 'How much does Sprigly cost?';
const runTopicId   = (runs[0]?.topic_id      as string | null) ?? null;

console.log(`\n── topicId=null search for: "${testQuestion}"`);
const nullChunks = await retrieveChunks(
  { clientId, queryText: testQuestion, topicId: null, k: 6 },
  { embeddingClient },
);
console.log(`Retrieved ${nullChunks.length} chunks (no topic filter):`);
for (const c of nullChunks) console.log(`  id=${c.id} score=${(c as any).score?.toFixed(4) ?? 'n/a'}`);

if (runTopicId) {
  console.log(`\n── topicId=${runTopicId} search (what the live run used):`);
  const filteredChunks = await retrieveChunks(
    { clientId, queryText: testQuestion, topicId: runTopicId, k: 6 },
    { embeddingClient },
  );
  console.log(`Retrieved ${filteredChunks.length} chunks (with topic filter):`);
  for (const c of filteredChunks) console.log(`  id=${c.id} score=${(c as any).score?.toFixed(4) ?? 'n/a'}`);
}

await sql.end();
process.exit(0);
