import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { sql } from './client.js';

// Migrations 0010-0021 were applied directly to the DB before drizzle tracking
// was in place. Record their hashes so the migrator skips them.
const entries = [
  { tag: '0010_selective_polling',                when: 1779439466000 },
  { tag: '0011_add_polling_columns',              when: 1779439526000 },
  { tag: '0012_routing_rules_auto_created',       when: 1779439586000 },
  { tag: '0013_routing_rules_auto_created_guard', when: 1779439646000 },
  { tag: '0014_triage_configs',                   when: 1779439706000 },
  { tag: '0015_triage_capture_log',               when: 1779439766000 },
  { tag: '0016_triage_seen_messages',             when: 1779439826000 },
  { tag: '0017_workflow_runs_outcome',            when: 1779439886000 },
  { tag: '0018_inbox_triage_prompts',             when: 1779439946000 },
  { tag: '0019_triage_digest',                    when: 1779440006000 },
  { tag: '0020_gmail_draft_id',                   when: 1779440066000 },
  { tag: '0021_verified_domain',                  when: 1779440126000 },
];

for (const e of entries) {
  const content = readFileSync(`./migrations/${e.tag}.sql`, 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${e.when})
    ON CONFLICT DO NOTHING
  `;
  console.log('recorded', e.tag, hash.slice(0, 12));
}

await sql.end();
process.exit(0);
