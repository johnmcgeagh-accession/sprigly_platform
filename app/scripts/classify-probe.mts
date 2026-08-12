/**
 * classify-probe.mts — what does the classifier do with ONE sentence, with and without a thread?
 *
 * Isolates the model call from the route, the database and the transforms, so a routing change
 * can be attributed to the prompt rather than guessed at. One Bedrock call per line printed.
 *
 * READ-ONLY: classifyIntake writes nothing. No auditor is passed, so this does not even leave
 * a ledger row — it is a probe, not a product path.
 */
import { classifyIntake } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';

const PLAN_MONTH = '2026-11';
const THREAD = 'CLIENT: move a post from the 17th to the week before\n'
  + 'ASSISTANT: move "Ethical, without cutting corners" 2026-11-17 → 2026-11-10;'
  + ' move "Maybe pushing a product that is a jumper" 2026-11-17 → 2026-11-10;'
  + ' move "giveaway post" 2026-11-17 → 2026-11-10';

const CASES: { text: string; thread?: string }[] = [
  { text: 'move a post from the 17th to the week before' },
  { text: 'I only wanted one of those moving' },
  { text: 'I only wanted one of those moving', thread: THREAD },
  { text: 'move it back', thread: THREAD },
];

const model = getModelClient();

for (const c of CASES) {
  const r = await classifyIntake({ text: c.text, planMonth: PLAN_MONTH, model, ...(c.thread ? { thread: c.thread } : {}) });
  const detail = r.scope === 'month_scoped'
    ? `kind=${r.intent.kind} subject="${r.intent.subject}" correctionOf="${(r.intent as { correctionOf?: string }).correctionOf ?? ''}" date=${r.intent.dateRange?.start ?? '—'}`
    : r.scope === 'evergreen' ? `reason=${r.reason}` : `kind=${(r as { kind?: string }).kind}`;
  console.log(`${c.thread ? '[thread] ' : '[bare]   '}"${c.text}"\n    → ${r.scope}  ${detail}\n`);
}

process.exit(0);
