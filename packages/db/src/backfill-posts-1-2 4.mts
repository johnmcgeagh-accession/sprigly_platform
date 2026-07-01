import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

const SLUGS = [
  'automate-your-workflows-a-founders-guide-to-reclaiming-15-hours-weekly',
  'why-generic-ai-tools-fail-encode-your-business-logic-first',
];

function extractJson(raw: string): Record<string, unknown> | null {
  const stripped = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  if (!stripped.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(stripped);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function applyReplacements(s: string): string {
  return s
    .replaceAll('john@aigura.co.uk', 'hello@sprigly.co.uk')
    .replaceAll('Aigura', 'Sprigly');
}

const rows = await sql`SELECT id, slug, body, faq FROM blog_posts WHERE slug = ANY(${SLUGS}) ORDER BY created_at`;

for (const row of rows) {
  const rawBody = row.body as string;
  const parsed = extractJson(rawBody);

  if (!parsed || typeof parsed['body'] !== 'string') {
    console.error(`[FAIL] ${row.slug}: could not parse JSON blob`);
    process.exitCode = 1;
    continue;
  }

  const extractedBody = parsed['body'] as string;
  const extractedFaq = (parsed['faq'] ?? row.faq) as unknown;

  const newBody = applyReplacements(extractedBody);
  const newFaq = JSON.parse(applyReplacements(JSON.stringify(extractedFaq)));

  await sql`
    UPDATE blog_posts
    SET body = ${newBody},
        faq  = ${sql.json(newFaq)}
    WHERE id = ${row.id as string}
  `;

  console.log(`[OK] ${row.slug}: body + faq updated`);
}

await sql.end();
