import { db, triageConfigs } from './index.js';
import { sql } from './client.js';
import { eq } from 'drizzle-orm';

const spriglyId = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';

const rows = await db
  .select({ id: triageConfigs.id, categories: triageConfigs.categories, voiceSample: triageConfigs.voiceSample })
  .from(triageConfigs)
  .where(eq(triageConfigs.clientId, spriglyId));

if (rows.length === 0) {
  console.log('NO triage_configs row for Sprigly — trigger path cannot fire');
} else {
  const row = rows[0]!;
  console.log('triage_config id:', row.id);
  const categories = row.categories as Array<{ key: string; label: string; action: string; description?: string }>;
  console.log(`\nCategories (${categories.length} total):`);
  for (const cat of categories) {
    console.log(`  key=${cat.key}`);
    console.log(`  action=${cat.action}`);
    console.log(`  label=${cat.label}`);
    if (cat.description) console.log(`  description=${cat.description}`);
    console.log();
  }
  const hasQA = categories.some(c => c.action === 'invoke_workflow:sprigly-question-answerer');
  console.log('Has invoke_workflow:sprigly-question-answerer?', hasQA ? 'YES' : 'NO');
}

await sql.end();
process.exit(0);
