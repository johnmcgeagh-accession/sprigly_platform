/**
 * seed-e2e.ts — deterministic seed for the Playwright harness (Stage 3).
 *
 * One tenant with plan_redesign ON, a current July-2026 cycle, 12 posts across
 * formats/statuses (incl. one email + one empty-checklist post), steps in mixed
 * done/at-risk states, one PENDING agent proposal, and several voice-sourced
 * plan_inputs. All ids and dates are fixed and framed around a frozen "today" of
 * 2026-07-08 (injected into the app via PLAN_TODAY) so derivations are stable in CI.
 *
 * Run with DATABASE_URL pointed at the disposable e2e container. Writes the magic-link
 * token to app/e2e/.auth/token.txt for the Playwright auth setup.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Lives in packages/db/src and imports the schema/client relatively (like migrate.ts),
// so it runs under `pnpm --filter @sprigly/db exec tsx src/seed-e2e.ts` with the clean
// db-package tsconfig — no root-tsconfig path-mapping quirks.
import { db, sql } from './client.js';
import {
  clients, clientConfigs, contentCycles, contentCyclePosts, postSteps,
  conversations, agentMessages, agentProposals, planInputs, appMagicLinkTokens,
} from './schema.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const CYCLE  = '22222222-2222-4222-8222-222222222222';
const CONV   = '44444444-4444-4444-8444-444444444444';
const MSG    = '55555555-5555-4555-8555-555555555555';
const PROP   = '66666666-6666-4666-8666-666666666666';
const P = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const TOKEN = 'e2e0000000000000000000000000000000000000000';
// Tenant B: a second, isolated tenant with an EMPTY current cycle and no notes.
const CLIENT_B = '77777777-7777-4777-8777-777777777777';
const CYCLE_B  = '88888888-8888-4888-8888-888888888888';
const TOKEN_B  = 'e2e1000000000000000000000000000000000000000';

const tpl = {
  reel: [['Script & hook', 4], ['Shoot', 3], ['Edit', 2], ['Caption', 1]],
  carousel: [['Source shots', 3], ['Design frames', 2], ['Caption', 1]],
  single: [['Source image', 2], ['Caption', 1]],
  email: [] as [string, number][],
} as const;

// [id, date, format, pillar, caption, status, done-flags, sourceMeta]
type Row = [string, string, keyof typeof tpl, string, string, string, boolean[], Record<string, unknown>];
const POSTS: Row[] = [
  [P(1), '2026-07-02', 'single', 'Product', 'Meet the butterfly top — the original caption.', 'planned', [true, true],
    { original: { caption: 'Meet the butterfly top — the original caption.', format: 'single', pillar: 'Product', scheduledDate: '2026-07-02', position: 1, status: 'planned' } }],
  [P(2), '2026-07-06', 'single', 'Product', 'What touches your skin — a note on fabric.', 'planned', [false, false], {}],
  [P(3), '2026-07-08', 'reel', 'Product', 'Sixty seconds on why natural fibres earn their keep.', 'planned', [true, false, false, false], {}],
  [P(4), '2026-07-09', 'single', 'Product', '', 'new', [], {}],
  [P(5), '2026-07-10', 'email', 'Origin', 'Monthly note from Sally — the thinking behind this drop.', 'planned', [], {}],
  [P(6), '2026-07-13', 'reel', 'Product', 'The boxes have arrived — first look at the samples.', 'edited', [true, true, false, false], {}],
  [P(7), '2026-07-16', 'single', 'Origin', 'What makes a great sweatshirt? Not all are built the same.', 'planned', [true, false], {}],
  [P(8), '2026-07-20', 'carousel', 'Origin', 'Why we make less, more carefully.', 'edited', [false, false, false], {}],
  [P(9), '2026-07-22', 'single', 'Product', '', 'new', [], {}],
  [P(10), '2026-07-24', 'single', 'Style', 'A capsule edit for rebuilding a summer wardrobe.', 'planned', [false, false], {}],
  [P(11), '2026-07-27', 'reel', 'Style', 'Slow, editorial cut of a weekend styled from the drop.', 'planned', [false, false, false, false], {}],
  [P(12), '2026-07-31', 'single', 'Origin', '', 'new', [], {}],
];

async function main() {
  // Silence the "truncate cascades to …" NOTICE wall for this seed session.
  await sql`SET client_min_messages TO warning`;

  // Reset: TRUNCATE the tenant tree in one shot. CASCADE handles FK order and — unlike
  // DELETE — bypasses plan_activity's append-only row trigger. step_templates has no FK
  // to clients, so the migration seed survives. The e2e container holds only this tenant.
  await sql`TRUNCATE TABLE clients CASCADE`;

  await db.insert(clients).values({ id: CLIENT, name: 'Ivy T', slug: 'e2e-ivy-t', status: 'active' });
  await db.insert(clientConfigs).values({ clientId: CLIENT, settings: { plan_redesign: true } });
  await db.insert(contentCycles).values({ id: CYCLE, clientId: CLIENT, channel: 'instagram', cycleMonth: '2026-07', status: 'active' });

  let position = 0;
  for (const [id, date, format, pillar, caption, status, dones, meta] of POSTS) {
    position += 1;
    await db.insert(contentCyclePosts).values({
      id, clientId: CLIENT, cycleId: CYCLE, channel: format === 'email' ? 'email' : 'instagram',
      scheduledDate: date, format, pillar, caption, status, position, sourceMeta: meta,
    });
    // The number of steps = the length of the done-flags array (so dones=[] means an
    // empty checklist — e.g. P4/P9/P12); labels/leads come from the format template.
    const steps = tpl[format];
    for (let i = 0; i < dones.length; i++) {
      const done = dones[i]!;
      await db.insert(postSteps).values({
        postId: id, label: steps[i]![0], leadDays: steps[i]![1], done,
        doneAt: done ? new Date('2026-07-01T09:00:00Z') : null, sort: i, createdBy: 'agent',
      });
    }
  }

  // One pending agent proposal: move P7 (16 Jul) → 27 Jul.
  await db.insert(conversations).values({ id: CONV, clientId: CLIENT, cycleId: CYCLE });
  await db.insert(agentMessages).values({ id: MSG, conversationId: CONV, role: 'user', content: 'move the sweatshirt post later', source: 'voice' });
  await db.insert(agentProposals).values({
    id: PROP, clientId: CLIENT, conversationId: CONV, messageId: MSG, intent: 'move_post',
    payload: { kind: 'move', cycleId: CYCLE, postId: P(7), toDate: '2026-07-27' },
    summary: 'Move “What makes a great sweatshirt?” to Sun 27 Jul', status: 'pending',
  });

  // Voice-sourced notes.
  for (const content of [
    'Push the launch a few days — the fabric delivery slipped.',
    'Make Fridays feel more personal, more Sally, less product.',
    'We want to lean into provenance this month.',
  ]) {
    await db.insert(planInputs).values({ clientId: CLIENT, cycleId: CYCLE, type: 'note', content, status: 'active', source: 'voice' });
  }

  // Magic-link token → session for the Playwright auth setup.
  await db.insert(appMagicLinkTokens).values({
    clientId: CLIENT, cycleId: CYCLE, token: TOKEN, expiresAt: new Date('2035-01-01T00:00:00Z'),
  });

  // Tenant B — empty current cycle, no notes/posts/proposals. Powers the empty-state and
  // cross-tenant-isolation tests. plan_redesign is on so its session lands on the redesign.
  await db.insert(clients).values({ id: CLIENT_B, name: 'Beta Co', slug: 'e2e-beta-co', status: 'active' });
  await db.insert(clientConfigs).values({ clientId: CLIENT_B, settings: { plan_redesign: true } });
  await db.insert(contentCycles).values({ id: CYCLE_B, clientId: CLIENT_B, channel: 'instagram', cycleMonth: '2026-07', status: 'active' });
  await db.insert(appMagicLinkTokens).values({ clientId: CLIENT_B, cycleId: CYCLE_B, token: TOKEN_B, expiresAt: new Date('2035-01-01T00:00:00Z') });

  const authDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', 'e2e', '.auth');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, 'token.txt'), TOKEN, 'utf8');
  writeFileSync(join(authDir, 'token-b.txt'), TOKEN_B, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`seeded ${POSTS.length} posts (tenant A) + empty tenant B; tokens written`);
  await sql.end();
}

main().catch((e) => { console.error('seed failed', e); process.exit(1); });
