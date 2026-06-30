import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
const SLUGS = [
  'automate-your-workflows-a-founders-guide-to-reclaiming-15-hours-weekly',
  'why-generic-ai-tools-fail-encode-your-business-logic-first',
];
const rows = await sql`SELECT slug, body, faq FROM blog_posts WHERE slug = ANY(${SLUGS}) ORDER BY created_at`;
for (const row of rows) {
  const body = row.body as string;
  const faq = JSON.stringify(row.faq);
  const bodyStartsWithJson = body.trimStart().startsWith('{') || body.trimStart().startsWith('```');
  const hasAigura = /aigura/i.test(body) || /aigura/i.test(faq);
  console.log(`${row.slug}`);
  console.log(`  body starts clean: ${!bodyStartsWithJson}`);
  console.log(`  aigura references: ${hasAigura ? 'YES — PROBLEM' : 'none'}`);
  console.log(`  body first 80 chars: ${body.slice(0, 80)}`);
  console.log(`  faq entry count: ${(row.faq as unknown[]).length}`);
}
await sql.end();
