/**
 * plan-ready-preview-cli.ts — what the plan-ready email WOULD say, without sending it.
 *
 *   pnpm --filter @sprigly/worker plan-ready-preview --cycle=<uuid>
 *   pnpm --filter @sprigly/worker plan-ready-preview            # every approved, unsent cycle
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 *
 * `settlePlanReady` is claim-first: it stamps `plan_ready_sent_at` BEFORE the send, so that a
 * throw costs an email rather than duplicating one. Correct, and it makes the live path unusable
 * for looking — asking it "what would this say?" either sends the mail or burns the cycle's one
 * claim. Ivy T's September settled and never sent, and there was no way to read the copy the
 * client did not get.
 *
 * `previewPlanReady` walks the same reads in the same order and stops at the edge: same app
 * link, same `countUngroundedPosts`, same published template, same `renderEmailTemplate`. No
 * claim, nothing handed to Gmail.
 *
 * READ-ONLY, and specifically: it takes no claim, writes no `plan_ready_sent_at` and sends
 * nothing. It DOES mint an app magic link if the cycle has none, because `ensureAppLink` is the
 * function the real path uses and a preview built on a different link would be a preview of a
 * different email. A cycle that already has a live link — the normal case — reuses it.
 *
 * WHAT IT CANNOT TELL YOU is whether the transport works. `send_failed` is invisible from here
 * by construction, because not sending is the point.
 */
import pino from 'pino';
import { Queue } from 'bullmq';
import { db } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createAuditLogger } from '@sprigly/audit';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { contentCycles } from '@sprigly/db';
import { previewPlanReady } from './plan-ready.js';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DbPromptResolver } from '@sprigly/prompts';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const logger = pino({ name: 'plan-ready-preview', level: 'warn' }, pino.destination(2));

const redisUrl = process.env['REDIS_URL'] ?? '';
if (!redisUrl) { console.error('plan-ready-preview: REDIS_URL unset — the settle check needs the queue'); process.exit(1); }
const queue = new Queue('content-cycles', { connection: { url: redisUrl } });

const deps = {
  db,
  encProvider: createEncryptionProvider(),
  googleClientId: process.env['GOOGLE_CLIENT_ID_UAT'] ?? process.env['GOOGLE_CLIENT_ID'] ?? '',
  googleClientSecret: process.env['GOOGLE_CLIENT_SECRET_UAT'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '',
  model: createModelClientFromEnv(),
  prompts: new DbPromptResolver(db),
  audit: createAuditLogger(db),
  logger,
};

const one = arg('cycle');
const cycleIds = one
  ? [one]
  : (await db.select({ id: contentCycles.id }).from(contentCycles)
      .where(and(isNotNull(contentCycles.approvedAt), isNull(contentCycles.planReadySentAt))))
      .map((r) => r.id);

if (!cycleIds.length) { console.log('No approved, unsent cycles.'); process.exit(0); }

const rule = (s: string) => console.log(`\n${'━'.repeat(84)}\n${s}\n${'━'.repeat(84)}`);

for (const id of cycleIds) {
  const p = await previewPlanReady(deps, queue, id);
  if (!p) { console.log(`\n${id} — no such cycle`); continue; }

  rule(`${p.cycleId}  —  would ${p.wouldSend === 'sent' ? 'SEND' : `NOT send (${p.wouldSend})`}`);
  console.log(`template      ${p.templateKey}${p.autoApproved ? '  (auto-approved variant)' : ''}`);
  console.log(`month         ${p.monthLabel}`);
  console.log(`waiting on client   ${p.waitingCount} declined post(s)`);
  console.log(`app link      ${p.appUrl ?? '(none — the real path would return no_link and retry)'}`);
  console.log(`\nMERGE FIELDS`);
  for (const [k, v] of Object.entries(p.merge)) {
    console.log(`  ${k.padEnd(15)} ${JSON.stringify(v)}`);
  }
  if (p.note) { console.log(`\n  ⚠ ${p.note}`); continue; }
  console.log(`\nSUBJECT\n  ${p.subject}`);
  console.log(`\nBODY\n${(p.body ?? '').split('\n').map((l) => `  ${l}`).join('\n')}`);
}

console.log(`\n\nNothing was sent, claimed or stamped.`);
await queue.close();
process.exit(0);
