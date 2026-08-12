/**
 * thread-window-cost.mts — what a parser window COSTS, with and without stored items.
 *
 *   pnpm --filter @sprigly/app exec vite-node --config vitest.config.ts \
 *     scripts/thread-window-cost.mts -- --conv=<uuid>
 *   ... -- --cycle=<uuid> --turns=12
 *
 * `threadForParser` serialises an assistant turn from its stored items and falls back to the
 * turn's raw prose when it has none. This runs the real serialiser over real rows TWICE — once
 * with the stored items honoured, once with them withheld — so the saving is measured rather
 * than estimated.
 *
 * The answer depends entirely on what the session is made of, which is why this prints the
 * split as well as the total: change receipts compact, and question ANSWERS deliberately do
 * not, because the answer is the referent a follow-up needs.
 *
 * READ-ONLY. One SELECT, no model call, no writes.
 */
import { db, conversations, agentMessages } from '@sprigly/db';
import { and, eq, desc } from 'drizzle-orm';
import { threadForParser, type ConversationTurn } from '../src/lib/agent/conversation';
import type { InterpretedItem } from '../src/lib/agent/types';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const CONV  = arg('conv');
const CYCLE = arg('cycle') ?? '5ea00045-155d-497b-ac2e-a27eae36f235';
const WINDOW = Number(arg('turns') ?? 12);

const cols = {
  id: agentMessages.id, role: agentMessages.role, content: agentMessages.content,
  createdAt: agentMessages.createdAt, metadata: agentMessages.metadata,
};

const rows = CONV
  ? await db.select(cols).from(agentMessages).where(eq(agentMessages.conversationId, CONV))
  : (await db.select(cols).from(agentMessages)
      .innerJoin(conversations, eq(agentMessages.conversationId, conversations.id))
      .where(and(eq(conversations.cycleId, CYCLE)))
      .orderBy(desc(agentMessages.createdAt)).limit(WINDOW)).reverse();

rows.sort((a, b) => +a.createdAt - +b.createdAt);

const itemsOf = (r: (typeof rows)[number]): InterpretedItem[] | undefined => {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return Array.isArray(meta['items']) ? (meta['items'] as InterpretedItem[]) : undefined;
};

/** The same turns, with stored items honoured or withheld. Withheld IS the old behaviour. */
const mk = (withItems: boolean): ConversationTurn[] => rows.map((r) => {
  const items = itemsOf(r);
  return {
    id: r.id, role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content,
    source: 'web' as const, createdAt: r.createdAt.toISOString(),
    ...(withItems && items ? { items } : {}),
  };
});

const before = threadForParser(mk(false), rows.length);
const after  = threadForParser(mk(true), rows.length);
const tok = (s: string) => Math.ceil(s.length / 4);
const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((1 - a / b) * 100)}%`);

console.log(`\n${CONV ? `conversation ${CONV}` : `cycle ${CYCLE}, last ${WINDOW}`} — ${rows.length} messages\n`);
console.log(`BEFORE (prose fallback)   ${String(before.length).padStart(5)} chars   ~${tok(before)} tokens`);
console.log(`AFTER  (stored items)     ${String(after.length).padStart(5)} chars   ~${tok(after)} tokens`);
console.log(`reduction                 ${before.length - after.length} chars, ~${tok(before) - tok(after)} tokens (${pct(after.length, before.length)})\n`);

/** The split, because the total hides which turns moved and which are meant not to. */
const kind = (r: (typeof rows)[number]) =>
  r.role !== 'assistant' ? 'client'
  : itemsOf(r)?.some((i) => i.kind === 'change') ? 'change receipt'
  : itemsOf(r)?.length ? 'filing'
  : 'prose (kept)';

const buckets = new Map<string, { n: number; b: number; a: number }>();
rows.forEach((r, i) => {
  const k = kind(r);
  const cur = buckets.get(k) ?? { n: 0, b: 0, a: 0 };
  const body = (t: ConversationTurn) => threadForParser([t]).replace(/^(ASSISTANT|CLIENT): /, '');
  buckets.set(k, { n: cur.n + 1, b: cur.b + body(mk(false)[i]!).length, a: cur.a + body(mk(true)[i]!).length });
});
console.log('by turn kind (chars of serialised body)');
for (const [k, v] of buckets) {
  console.log(`  ${k.padEnd(15)} n=${String(v.n).padEnd(3)} before ${String(v.b).padStart(5)}   after ${String(v.a).padStart(5)}   ${pct(v.a, v.b)}`);
}
console.log(`\n── the window, AFTER ─────────────────────────────────────────\n${after}\n──────────────────────────────────────────────────────────────\n`);

process.exit(0);
