import { sql } from './client.js';

const steps: Array<{ table: string; col: string }> = [
  { table: 'incoming_events',  col: 'source_metadata' },
  { table: 'incoming_events',  col: 'content' },
  { table: 'routing_rules',    col: 'match_conditions' },
  { table: 'routing_rules',    col: 'destinations' },
  { table: 'audit_log',        col: 'metadata' },
  { table: 'approvals',        col: 'output_snapshot' },
  { table: 'workflow_outputs', col: 'output' },
  { table: 'workflow_runs',    col: 'output' },
  { table: 'blog_posts',       col: 'faq' },
  { table: 'clients',          col: 'settings' },
  { table: 'client_configs',   col: 'settings' },
  { table: 'prospect_sheets',  col: 'research' },
];

console.log('Fixing JSONB double-encoding...\n');

for (const { table, col } of steps) {
  const result = await sql.unsafe(`
    UPDATE ${table}
    SET    ${col} = (${col} #>> '{}')::jsonb
    WHERE  ${col} IS NOT NULL
    AND    jsonb_typeof(${col}) = 'string'
  `);
  const count = result.count;
  if (count > 0) {
    console.log(`  ✓ ${table}.${col}: fixed ${count} row(s)`);
  } else {
    console.log(`  · ${table}.${col}: no affected rows`);
  }
}

console.log('\nDone.');
await sql.end();
