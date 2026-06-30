import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);
const rows = await sql`SELECT id, slug, title, created_at FROM blog_posts ORDER BY created_at`;
for (const row of rows) {
  console.log(`${row.created_at} | ${row.slug} | ${row.title}`);
}
await sql.end();
