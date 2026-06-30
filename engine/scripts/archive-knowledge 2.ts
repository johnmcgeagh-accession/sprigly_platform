/**
 * archive-knowledge.ts — move all active knowledge chunks for a client to 'archived'.
 *
 * Archived chunks are excluded from retrieval (status = 'active' filter in retrieveChunks).
 * Nothing is deleted — rows remain queryable for audit.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker archive:knowledge <clientId>
 *
 * Run via:
 *   sh -c 'set -a && . ../../.env.local && set +a && tsx scripts/archive-knowledge.ts <clientId>'
 */

import { sql } from '@sprigly/db';

const [clientId] = process.argv.slice(2);

if (!clientId) {
  console.error('Usage: archive-knowledge.ts <clientId>');
  process.exit(1);
}

const result = await sql`
  UPDATE knowledge_chunks
  SET    status     = 'archived',
         updated_at = now()
  WHERE  client_id  = ${clientId}::uuid
    AND  status     = 'active'
  RETURNING id
`;

console.log(`Archived ${result.length} chunk(s) for client ${clientId}.`);
if (result.length > 0) {
  for (const r of result) console.log(`  ${r.id}`);
}

await sql.end();
process.exit(0);
