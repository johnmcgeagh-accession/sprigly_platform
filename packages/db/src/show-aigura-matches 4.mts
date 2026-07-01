import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);
const rows = await sql`SELECT slug, body FROM blog_posts WHERE slug IN ('automate-your-workflows', 'why-generic-ai-tools-fail') ORDER BY created_at`;
for (const row of rows) {
  console.log(`=== SLUG: ${row.slug} ===`);
  const lines = (row.body as string).split('\n');
  lines.forEach((line: string, i: number) => {
    if (/aigura/i.test(line)) {
      console.log(`  L${i + 1}: ${line}`);
    }
  });
  console.log('');
}
await sql.end();
