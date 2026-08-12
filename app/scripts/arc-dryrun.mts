/**
 * arc-dryrun.mts — would the CURRENT code place the tease where the brief says?
 *
 * Reads the real cycle and its real structured_brief, reconstructs the month as it stood
 * before the arc landed, and computes the ops. Nothing is written.
 */
import { db, contentCycles, contentCyclePosts } from '@sprigly/db';
import { and, eq, isNull } from 'drizzle-orm';
import { briefArcDatesFor, classifyIntake, applyIntent, type TransformBeat } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';

const CYCLE = '5be2396c-8d50-4fa0-ab10-9e80ddf8715d';
const TEXT = 'On the 12th we are going to launch Hannah in green, can you write a teaser the week before';

const [c] = await db.select({ b: contentCycles.structuredBrief }).from(contentCycles).where(eq(contentCycles.id, CYCLE));
const rows = await db.select({
  id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate, format: contentCyclePosts.format,
  pillar: contentCyclePosts.pillar, position: contentCyclePosts.position, beatMeta: contentCyclePosts.beatMeta,
  sourceMeta: contentCyclePosts.sourceMeta,
}).from(contentCyclePosts).where(and(
  eq(contentCyclePosts.cycleId, CYCLE), eq(contentCyclePosts.status, 'draft'), isNull(contentCyclePosts.deletedAt)));

// The month as it was BEFORE the arc landed: drop the three beats the arc created.
const beats: TransformBeat[] = rows
  .filter((r) => !String(r.sourceMeta?.['title'] ?? '').startsWith('Hannah in green —'))
  .map((r) => ({
    id: r.id, date: r.scheduledDate, format: r.format, pillar: r.pillar ?? '',
    title: typeof r.sourceMeta?.['title'] === 'string' ? r.sourceMeta['title'] as string : (r.pillar ?? ''),
    position: r.position, beatMeta: r.beatMeta,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);

const r = await classifyIntake({ text: TEXT, planMonth: '2027-01', model: getModelClient(), context: 'brief_segment' });
if (r.scope !== 'month_scoped') { console.log('not month_scoped'); process.exit(0); }
const arc = briefArcDatesFor(c!.b, r.intent.subject);
const intent = arc.launch ? { ...r.intent, dateRange: { start: arc.launch, end: arc.launch } } : r.intent;
const res = applyIntent(intent, beats, '2027-01', '2026-12-01', [], arc);

console.log(`subject="${r.intent.subject}"  arc=${JSON.stringify(arc)}  beats in month=${beats.length}`);
console.log('\nWOULD place (current code, nothing written):');
for (const o of res.ops) if (o.op === 'add') console.log(`  ${o.date}  ${o.title}`);
console.log('\nACTUALLY on the cycle today (placed 21:25 BST, 15 min before fe8c250):');
console.log('  2027-01-07  Hannah in green — Tease');
console.log('  2027-01-12  Hannah in green — Launch');
console.log('  2027-01-15  Hannah in green — Follow-up');
process.exit(0);
