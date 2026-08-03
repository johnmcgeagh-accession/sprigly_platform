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
import { eq } from 'drizzle-orm';
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
// Adjacent August cycle for tenant A (read-only sibling; exercises month-nav).
const CYCLE_AUG = '99999999-9999-4999-8999-999999999999';
const PA = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
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
  // cycle_month is the DATA month; the PLAN month it displays is cycleMonth + 1
  // (plan.ts:250, displayMonth = nextMonth(cycleMonth)). These posts are dated in July, so
  // the cycle that plans them is JUNE's. The seed said '2026-07' — which displays as August —
  // so every July post fell outside the grid the app was showing, and the desktop rendered 3
  // chips (August's, surfaced cross-month) instead of 12. Never caught because this suite had
  // never been run.
  await db.insert(contentCycles).values({ id: CYCLE, clientId: CLIENT, channel: 'instagram', cycleMonth: '2026-06', status: 'active' });

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

  // Give the "The boxes have arrived" reel (P6) a saved hook + script so the editor's Shape
  // target control (Caption | Hook | Script) and the agent refine flow are exercisable (§26).
  await sql`
    UPDATE content_cycle_posts
       SET hook = 'The boxes have arrived, and we filmed the first look.',
           script = E'HOOK: The boxes have arrived, and we filmed the first look.\n\nBEAT 1 (0-6s) — First cut of the tape, the first piece lifted out. (unboxing)\nBEAT 2 (6-20s) — A close look at the stitching and the colour in daylight. (macro)\n\nCTA: Comment ''samples'' to see them first.',
           script_length_seconds = 30
     WHERE id = ${P(6)}`;

  // An adjacent August cycle (same client + channel) so month-nav is exercisable — it
  // opens READ-ONLY (only the home July cycle is editable). A few posts so it qualifies
  // for the switcher list (loadCycleList needs liveCount > 0).
  // Displays as AUGUST — the adjacent month desktop.spec's nav test round-trips to.
  await db.insert(contentCycles).values({ id: CYCLE_AUG, clientId: CLIENT, channel: 'instagram', cycleMonth: '2026-07', status: 'active' });
  const AUG: [string, string, keyof typeof tpl, string, string][] = [
    [PA(1), '2026-08-04', 'single',   'Product', 'August opener — the linen restock is live.'],
    [PA(2), '2026-08-12', 'reel',     'Style',   'Three ways to wear the new midi.'],
    [PA(3), '2026-08-21', 'carousel', 'Origin',  'Where the August fabrics come from.'],
  ];
  let augPos = 0;
  for (const [id, date, format, pillar, caption] of AUG) {
    augPos += 1;
    await db.insert(contentCyclePosts).values({
      id, clientId: CLIENT, cycleId: CYCLE_AUG, channel: 'instagram',
      scheduledDate: date, format, pillar, caption, status: 'planned', position: augPos, sourceMeta: {},
    });
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

  // ── Durable inputs in every state the Ideas view can draw (W6) ────────────────────
  //
  // The three notes above are all `active`/`candidate`, so before this the seed could only
  // ever produce one column — "waiting" — and the states that carry the actual claim of the
  // view (that we can tell a client what became of what they said) were untestable end to end.
  // These four are the four states, and the used one is wired to a real post so the
  // tap-through has somewhere to go.
  const USED_IDEA = '33333333-3333-4333-8333-333333333331';
  await db.insert(planInputs).values([
    {
      id: USED_IDEA, clientId: CLIENT, type: 'idea', source: 'voice',
      content: 'Shoot the provenance story on film, not phone.',
      // status stays 'active' — the pairing that breaks a reader trusting either column alone.
      status: 'active', lifecycle: 'used', usedInCycleId: CYCLE,
    },
    {
      clientId: CLIENT, type: 'next_cycle', source: 'voice',
      content: 'Save the winter fabric piece for the month after this one.',
      status: 'active', lifecycle: 'candidate',
    },
    {
      clientId: CLIENT, type: 'idea', source: 'web',
      content: 'A giveaway with the tote bags.',
      status: 'active', lifecycle: 'declined',
    },
    {
      clientId: CLIENT, type: 'idea', source: 'voice',
      content: 'More behind-the-scenes from the studio.',
      status: 'active', lifecycle: 'candidate',
    },
  ]);
  // The beat that idea became. `sourceRef` is what the draft assembler writes when an
  // allocation carries a candidate (draft-assembly.ts), and it is the ONLY link from an
  // input to a specific post — used_in_cycle_id names the month, not the beat. The shape is
  // the assembler's own: an experiment slot, carrying her sentence so a surface can quote it.
  await db.update(contentCyclePosts)
    .set({
      beatMeta: {
        slotType: 'experiment',
        rationaleEvidence: {
          basis: 'client_input',
          backlogIdea: { text: 'Shoot the provenance story on film, not phone.', givenAt: '2026-06-14' },
        },
        sourceRef: USED_IDEA,
      },
    })
    .where(eq(contentCyclePosts.id, P(8)));

  // Magic-link token → session for the Playwright auth setup.
  await db.insert(appMagicLinkTokens).values({
    clientId: CLIENT, cycleId: CYCLE, token: TOKEN, expiresAt: new Date('2035-01-01T00:00:00Z'),
  });

  // Tenant B — empty current cycle, no notes/posts/proposals. Powers the empty-state and
  // cross-tenant-isolation tests. plan_redesign is on so its session lands on the redesign.
  await db.insert(clients).values({ id: CLIENT_B, name: 'Beta Co', slug: 'e2e-beta-co', status: 'active' });
  await db.insert(clientConfigs).values({ clientId: CLIENT_B, settings: { plan_redesign: true } });
  // Tenant B's empty month, displaying JULY like tenant A's — same off-by-one as above.
  await db.insert(contentCycles).values({ id: CYCLE_B, clientId: CLIENT_B, channel: 'instagram', cycleMonth: '2026-06', status: 'active' });
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
