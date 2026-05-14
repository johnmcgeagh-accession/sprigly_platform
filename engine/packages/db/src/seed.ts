import { eq, and } from 'drizzle-orm';
import { db, sql } from './client.js';
import { clients, users, clientConfigs, routingRules, promptTemplates } from './schema.js';

const RESEARCH_PROMPT = `CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.

You are researching a blog post topic for a professional services audience.

Topic: {{topic}}

Return a JSON object with:
- targetKeyword: the primary SEO keyword (2-4 words)
- angles: array of 3-5 key angles or pain points to address
- faq: array of 5 frequently asked questions with answers (objects with "question" and "answer" keys)
- researchNotes: a paragraph summarising the key points to cover

Respond only with valid JSON, no markdown fences.

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.`;

const STRUCTURE_PROMPT = `CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.

You are structuring a blog post for a professional audience.

Topic: {{topic}}
Research: {{research}}

Return a JSON object with:
- title: an engaging, SEO-optimised title (under 65 characters, no em dashes)
- excerpt: a compelling summary (under 155 characters)
- metaDescription: SEO meta description (under 160 characters)
- category: a single category label (e.g. "Technology", "Strategy", "Operations")
- cta: a short call-to-action sentence for the end of the post

Respond only with valid JSON, no markdown fences.

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.`;

const WRITE_PROMPT = `CRITICAL RULES — FOLLOW EXACTLY:
- NEVER USE EM DASHES (—). This is a hard rule. No exceptions.
  BAD: "Your work isn't good—it is." GOOD: "Your work is good. That is not the problem."
  Use commas, full stops, or parentheses instead.
- Do not use: "seamlessly", "unlock", "empower", "leverage", "game-changer", "delve", "in today's", "it's worth noting".

You are writing a professional blog post.

Topic: {{topic}}
Title: {{title}}
Target keyword: {{keyword}}
Research: {{research}}

Write a complete blog post in markdown format, 900-1200 words. Use the title as a H1 heading. Include 3-4 H2 sections. Write in a direct, structured, practical style. Professional without being corporate. End the post with this call-to-action from the structure JSON.

Respond with the markdown content only, no preamble.

Reminder: no em dashes (—). Use commas, full stops, or parentheses instead.`;

await db.insert(clients).values({
  name: 'Sprigly',
  slug: 'sprigly',
  status: 'active',
  settings: {},
}).onConflictDoNothing();

const spriglyRows = await db.select().from(clients).where(eq(clients.slug, 'sprigly'));
const sprigly = spriglyRows[0];
if (!sprigly) throw new Error('Seed: could not find Sprigly client after insert');

await db.insert(users).values({
  email: 'john@sprigly.co.uk',
  role: 'admin',
  clientId: null,
}).onConflictDoNothing();

console.log('Seed complete — Sprigly client id:', sprigly.id);

// ClientConfig
let spriglyConfigId: string;
const existingConfig = await db
  .select({ id: clientConfigs.id })
  .from(clientConfigs)
  .where(eq(clientConfigs.clientId, sprigly.id))
  .limit(1);

if (existingConfig[0] !== undefined) {
  spriglyConfigId = existingConfig[0].id;
  console.log('ClientConfig already exists:', spriglyConfigId);
} else {
  const [inserted] = await db.insert(clientConfigs).values({
    clientId: sprigly.id,
    brandVoice: 'Direct, structured, practical. Professional without being corporate. Every sentence earns its place.',
    signature: 'John\nSprigly',
    authorName: 'John McGeagh',
    settings: { model: 'haiku' },
  }).returning({ id: clientConfigs.id });
  if (!inserted) throw new Error('Seed: clientConfig insert failed');
  spriglyConfigId = inserted.id;
  console.log('ClientConfig created:', spriglyConfigId);
}

// Routing rule
const existingRule = await db
  .select({ id: routingRules.id })
  .from(routingRules)
  .where(and(
    eq(routingRules.clientId, sprigly.id),
    eq(routingRules.workflowId, 'sprigly-blog-post'),
  ))
  .limit(1);

if (existingRule[0] !== undefined) {
  console.log('Routing rule already exists:', existingRule[0].id);
} else {
  const [rule] = await db.insert(routingRules).values({
    clientId: sprigly.id,
    enabled: true,
    source: 'email',
    matchConditions: [
      { field: 'subject', op: 'startsWith', value: 'Blog:', caseSensitive: false },
    ],
    workflowId: 'sprigly-blog-post',
    destinations: [
      { destinationId: 'db-save-blog-post', requireApproval: false, settings: {} },
      { destinationId: 'gmail-send-notification', requireApproval: false, settings: { toEmail: 'john@sprigly.co.uk' } },
    ],
    clientConfigId: spriglyConfigId,
    priority: 10,
  }).returning({ id: routingRules.id });
  console.log('Routing rule created:', rule?.id);
}

// Prompt templates
const steps = [
  { stepName: 'research', promptText: RESEARCH_PROMPT },
  { stepName: 'structure', promptText: STRUCTURE_PROMPT },
  { stepName: 'write', promptText: WRITE_PROMPT },
] as const;

for (const { stepName, promptText } of steps) {
  const existing = await db
    .select({ id: promptTemplates.id })
    .from(promptTemplates)
    .where(and(
      eq(promptTemplates.clientId, sprigly.id),
      eq(promptTemplates.workflowId, 'sprigly-blog-post'),
      eq(promptTemplates.stepName, stepName),
      eq(promptTemplates.version, 1),
    ))
    .limit(1);

  if (existing[0] !== undefined) {
    console.log(`Prompt template '${stepName}' already exists`);
    continue;
  }

  await db.insert(promptTemplates).values({
    clientId: sprigly.id,
    workflowId: 'sprigly-blog-post',
    stepName,
    promptText,
    version: 1,
  });
  console.log(`Prompt template '${stepName}' created`);
}

console.log('Seed complete.');
await sql.end();
