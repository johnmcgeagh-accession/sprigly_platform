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
  // Case-sensitive, separate passes — order matters (email first to avoid double-hit)
  return s
    .replaceAll('john@aigura.co.uk', 'hello@sprigly.co.uk')
    .replaceAll('Aigura', 'Sprigly');
}

const rows = await sql`SELECT id, slug, body, faq FROM blog_posts WHERE slug = ANY(${SLUGS}) ORDER BY created_at`;

for (const row of rows) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`SLUG: ${row.slug}`);
  console.log('='.repeat(72));

  const rawBody = row.body as string;
  const parsed = extractJson(rawBody);

  if (!parsed || typeof parsed['body'] !== 'string') {
    console.log('  [WARN] Could not parse JSON blob — body column content:');
    console.log('  ', rawBody.slice(0, 200));
    continue;
  }

  const extractedBody = parsed['body'] as string;
  const extractedFaq = parsed['faq'] ?? row.faq;

  const newBody = applyReplacements(extractedBody);
  const newFaqStr = applyReplacements(JSON.stringify(extractedFaq));
  const newFaq = JSON.parse(newFaqStr);

  // Show body diff (lines containing aigura before, and the replacement after)
  console.log('\n--- BODY BEFORE (aigura lines only) ---');
  extractedBody.split('\n').forEach((line, i) => {
    if (/aigura/i.test(line)) console.log(`  L${i + 1}: ${line}`);
  });

  console.log('\n--- BODY AFTER (same lines) ---');
  newBody.split('\n').forEach((line, i) => {
    const orig = extractedBody.split('\n')[i]!;
    if (/aigura/i.test(orig)) console.log(`  L${i + 1}: ${line}`);
  });

  const faqBefore = JSON.stringify(extractedFaq, null, 2);
  const faqAfter = JSON.stringify(newFaq, null, 2);
  if (faqBefore !== faqAfter) {
    console.log('\n--- FAQ BEFORE ---');
    console.log(faqBefore);
    console.log('\n--- FAQ AFTER ---');
    console.log(faqAfter);
  } else {
    console.log('\n--- FAQ: no aigura matches ---');
  }

  const bodyChanged = newBody !== extractedBody;
  const faqChanged = faqBefore !== faqAfter;
  console.log(`\n  body changed: ${bodyChanged} | faq changed: ${faqChanged}`);
  console.log(`  body length (extracted): ${extractedBody.length} → ${newBody.length}`);
}

await sql.end();
