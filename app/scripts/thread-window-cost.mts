/**
 * thread-window-cost.mts — what a 12-turn parser window COSTS on a real cycle.
 *
 *   pnpm --filter @sprigly/app exec tsx scripts/thread-window-cost.mts --cycle=<uuid>
 *
 * `threadForParser` serialises an assistant turn from its RESOLVED items, and falls back to the
 * turn's raw prose when it has none. Draft-apply turns carried no items, so the whole receipt
 * went into the window verbatim. This measures the difference on stored rows rather than on an
 * estimate: the SAME turns, serialised both ways.
 *
 * READ-ONLY. One SELECT, no model call, no writes.
 */
import { db, conversations, agentMessages } from '@sprigly/db';
import { and, eq, desc } from 'drizzle-orm';
import { threadForParser, type ConversationTurn } from '../src/lib/agent/conversation';
import { receiptItems } from '../src/lib/receipt-items';
import type { InterpretedItem } from '../src/lib/agent/types';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const CYCLE = arg('cycle') ?? '5ea00045-155d-497b-ac2e-a27eae36f235';
const WINDOW = Number(arg('turns') ?? 12);

/** Bedrock bills tokens, not characters. ~4 chars/token is the standard English approximation
 *  and is used for BOTH numbers, so the ratio is exact even where the absolute is approximate. */
const tokens = (s: string) => Math.ceil(s.length / 4);

const rows = await db
  .select({
    id: agentMessages.id, role: agentMessages.role, content: agentMessages.content,
    source: agentMessages.source, createdAt: agentMessages.createdAt,
    metadata: agentMessages.metadata, writer: agentMessages.writer,
  })
  .from(agentMessages)
  .innerJoin(conversations, eq(agentMessages.conversationId, conversations.id))
  .where(and(eq(conversations.cycleId, CYCLE)))
  .orderBy(desc(agentMessages.createdAt))
  .limit(WINDOW);

const ordered = rows.reverse();

/** The turns as they are stored TODAY. */
const before: ConversationTurn[] = ordered.map((r) => {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const items = Array.isArray(meta['items']) ? (meta['items'] as InterpretedItem[]) : undefined;
  return {
    id: r.id, role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content,
    source: r.source === 'voice' ? 'voice' : 'web', createdAt: r.createdAt.toISOString(),
    ...(items ? { items } : {}),
  };
});

/**
 * The same turns with the items this build gives them.
 *
 * Rebuilt from the STORED receipt where one is recoverable, so this is a measurement of real
 * content and not of a fixture. `deltas` did not exist when these rows were written, so a
 * receipt-carrying turn is reconstructed from its rendered lines' own shape — see the note in
 * the output: turns with no recoverable structure keep their prose in both columns, which makes
 * this a CONSERVATIVE reading of the saving rather than a flattering one.
 */
const after: ConversationTurn[] = before.map((t, i) => {
  const meta = (ordered[i]!.metadata ?? {}) as Record<string, unknown>;
  if (t.role !== 'assistant' || t.items?.length) return t;
  const lines = t.content.split('\n').map((l) => l.trim()).filter(Boolean);
  // A receipt's change lines are the ones diffBeats rendered. Anything else (a model's answer
  // to a question, a filing sentence) has no delta behind it and keeps its prose.
  const deltas = lines.flatMap((l) => {
    const m = /^Moved: (.+), (\w{3} \d{1,2} \w{3}) → (\w{3} \d{1,2} \w{3})$/.exec(l);
    if (m) return [{ type: 'moved' as const, beat: { id: `b${i}`, date: '', format: '', pillar: '', title: m[1]! }, from: m[2]!, to: m[3]! }];
    const a = /^Added: (.+), (\w{3} \d{1,2} \w{3})$/.exec(l);
    if (a) return [{ type: 'added' as const, beat: { id: `b${i}`, date: a[2]!, format: '', pillar: '', title: a[1]! } }];
    return [];
  });
  const items = receiptItems({ scope: 'month_scoped', deltas, ...(meta['receiptId'] ? {} : {}) });
  return items.length ? { ...t, items } : t;
});

const b = threadForParser(before, WINDOW);
const a = threadForParser(after, WINDOW);

const pct = (x: number, y: number) => (y === 0 ? '—' : `${Math.round((1 - x / y) * 100)}%`);

console.log(`\ncycle ${CYCLE} — last ${WINDOW} messages (${ordered.length} found)\n`);
console.log('BEFORE (prose fallback)');
console.log(`  ${b.length} chars   ~${tokens(b)} tokens`);
console.log('\nAFTER (serialised from items)');
console.log(`  ${a.length} chars   ~${tokens(a)} tokens`);
console.log(`\nreduction: ${b.length - a.length} chars, ~${tokens(b) - tokens(a)} tokens (${pct(a.length, b.length)})\n`);
console.log('── the window, AFTER ─────────────────────────────────────────');
console.log(a);
console.log('──────────────────────────────────────────────────────────────\n');

/**
 * The same comparison split by what the turn IS, because the aggregate hides the answer.
 *
 * A window's cost is dominated by whichever turns are long, and on this surface the long ones
 * are question ANSWERS — which this build deliberately leaves as prose, because the answer is
 * the referent a follow-up needs. Compacting the change receipts therefore moves the total
 * barely at all, and saying "7× cheaper" over that would be false.
 */
const kindOf = (t: ConversationTurn, i: number) =>
  t.role === 'user' ? 'client'
  : after[i]!.items?.length ? 'change receipt'
  : /saved it to your ideas|kept this for later/.test(t.content) ? 'filing'
  : 'question answer';

const buckets = new Map<string, { n: number; before: number; after: number }>();
before.forEach((t, i) => {
  const k = kindOf(t, i);
  const cur = buckets.get(k) ?? { n: 0, before: 0, after: 0 };
  const bTxt = t.items?.length ? '' : t.content;
  const aTurn = after[i]!;
  const aTxt = aTurn.items?.length
    ? threadForParser([aTurn]).replace(/^ASSISTANT: /, '')
    : aTurn.content;
  buckets.set(k, { n: cur.n + 1, before: cur.before + bTxt.length, after: cur.after + aTxt.length });
});

console.log('by turn kind (chars of serialised body)');
for (const [k, v] of buckets) {
  console.log(`  ${k.padEnd(15)} n=${String(v.n).padEnd(3)} before ${String(v.before).padStart(5)}   after ${String(v.after).padStart(5)}   ${pct(v.after, v.before)}`);
}
console.log('');

process.exit(0);
