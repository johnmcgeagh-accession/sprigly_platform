/**
 * brief-prompt-preview.ts — Phase 3b read-only preview.
 *
 * Assembles and prints the generate-plan prompt for one cycle exactly as it WILL be
 * sent at regen: SYSTEM = generate-plan v4 (the 0057 BRIEF AUTHORITY framing) and
 * USER = the assembled inputs including the STRUCTURED BRIEF section. Lets a human
 * read that generation is brief-led BEFORE spending a regen.
 *
 * READ-ONLY: no plan is generated, nothing is persisted, no delivery. 0057 is NOT
 * applied — the v4 system prompt is SIMULATED in memory by inserting the same block
 * 0057 inserts, so the preview matches post-apply without touching the DB. If the
 * cycle has no persisted structured_brief, one is extracted in memory (not saved).
 * NOT for committing.
 *
 * Run:
 *   cd engine && set -a && . ../.env.local && set +a && \
 *     pnpm exec tsx src/content-cycles/brief-prompt-preview.ts [cycleId]
 */

import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { createEncryptionProvider } from '@sprigly/oauth-tokens';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createAuditLogger } from '@sprigly/audit';
import { DbPromptResolver } from '@sprigly/prompts';
import type { StructuredBrief, IntakeJson } from '@sprigly/engine';
import { assembleShapeContext, nextMonth } from './planning.js';
import { extractStructuredBrief } from './brief-extract.js';

// Mirrors the BRIEF AUTHORITY block inserted by migration 0057 (generate-plan v3→v4),
// used only to SIMULATE v4 here without applying 0057. Keep in sync with 0057.
const BRIEF_AUTHORITY_BLOCK = `BRIEF AUTHORITY (this decides WHAT to feature and WHEN, and overrides your own product picks). The client's brief is authoritative, not advisory, and its concrete form is the STRUCTURED BRIEF in the user message. Treat the STRUCTURED BRIEF as ground truth: its BRIEFED LAUNCHES / RESTOCKS are the ONLY launches and restocks this month; its FIXED DATED BEATS give the dates you must use (do not infer, shift, or de-collide dates of your own); its UNDATED CONTENT PIECES must each appear once in the month; its PLAN WINDOW bounds every date. Where the STRUCTURED BRIEF and the free-text INTAKE ever disagree, the STRUCTURED BRIEF WINS. Build the month from these briefed items first, and treat everything else as secondary to them. The PRODUCTS (catalogue) list is real name and colourway VOCABULARY for grounding and validation only. It is NOT a menu of things to feature, and a product appearing in it is not a reason to feature it; a colourway marked [BRIEFED LAUNCH] there is a real, briefed colourway you may use for the product it sits under. A product that is NOT in the STRUCTURED BRIEF's launches, restocks or schedule may appear ONLY as clearly secondary support (a supporting piece in an outfit, or a light cross sell) and must NEVER be a hero, a launch, a return, or described as "new". Do not invent a launch, a "coming soon", an "arrives" or "goes live" moment, or any date the STRUCTURED BRIEF did not state; if a product is not in the brief as launching or returning, treat it as an already existing product and never imply otherwise. Feature only what the brief and the data actually contain, and never present anything as briefed that the client did not brief.`;

// Required, no fallback: this used to default to a real production cycle, and unlike its
// two siblings it makes a Bedrock call — so a bare invocation spent money reading someone
// else's month.
const cycleId = process.argv[2];
if (!cycleId) {
  console.error('brief-prompt-preview: missing required argument <cycleId>.');
  console.error('usage: pnpm exec tsx src/content-cycles/brief-prompt-preview.ts <cycleId>');
  process.exit(1);
}

const deps = {
  db,
  encProvider:        createEncryptionProvider(),
  googleClientId:     process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  model:              createModelClientFromEnv(),
  prompts:            new DbPromptResolver(db),
  audit:              createAuditLogger(db),
  logger:             pino({ name: 'brief-prompt-preview', level: 'warn' }),
};

const [cycle] = await db.select().from(contentCycles).where(eq(contentCycles.id, cycleId)).limit(1);
if (!cycle) { console.error(`cycle ${cycleId} not found`); process.exit(1); }

// Mirror runPlanningForCycle's ensure-brief, but READ-ONLY (never persist).
let brief = (cycle.structuredBrief ?? null) as StructuredBrief | null;
if (brief) {
  console.log('(read persisted structured_brief from the cycle row)');
} else {
  const planContent = (cycle.intakeJson as IntakeJson | null)?.planContent ?? { answers: {}, freeNotes: '' };
  brief = await extractStructuredBrief({ planContent, planMonth: nextMonth(cycle.cycleMonth), model: deps.model, logger: deps.logger });
  console.log('(structured_brief not persisted yet — extracted in memory for the preview, not saved)');
}
cycle.structuredBrief = brief;

const ctx = await assembleShapeContext(cycle, deps);

const alreadyV4 = ctx.systemPrompt.includes('BRIEF AUTHORITY');
const systemV4 = alreadyV4
  ? ctx.systemPrompt
  : ctx.systemPrompt.replace('Work through these steps:', `${BRIEF_AUTHORITY_BLOCK}\n\nWork through these steps:`);

console.log('');
console.log('================= SYSTEM PROMPT (generate-plan v4) =================');
console.log(alreadyV4 ? '[0057 already applied — v4 from DB]' : '[0057 NOT applied — v4 SIMULATED in memory; DB still serves v3]');
console.log('-------------------------------------------------------------------');
console.log(systemV4);
console.log('');
console.log('================= USER MESSAGE (assembled inputs) =================');
console.log(ctx.userMessage);
console.log('');
console.log('=================================================================');
console.log(`brief: products=${brief.products.length} schedule=${brief.schedule.length} content_asks=${brief.content_asks.length} conflicts=${brief.conflicts.length}`);
process.exit(0);
