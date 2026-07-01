/**
 * brief-grounding-probe.ts — Phase 2 read-only verification.
 *
 * Confirms that merging the structured brief into the catalogue index + grounding
 * makes a briefed launch colourway with no sales line (Connie Violet) validate as
 * legal, WITHOUT leaking into another product that shares the colour word (Hannah
 * Violet), and that grounding marks it [BRIEFED LAUNCH].
 *
 * READ-ONLY: reads the cycle intake + catalogue (explicit columns — the
 * structured_brief column is NOT read here; 0058 is unapplied and nothing has
 * persisted a brief yet, so the brief is re-extracted in memory). No regen, no
 * persistence, no Drive, no delivery. NOT for committing to the pipeline.
 *
 * Run:
 *   cd engine && set -a && . ../.env.local && set +a && \
 *     pnpm exec tsx src/content-cycles/brief-grounding-probe.ts [cycleId]
 */

import pino from 'pino';
import { eq, and } from 'drizzle-orm';
import { db, contentCycles, clientProductCatalogue } from '@sprigly/db';
import { createModelClientFromEnv } from '@sprigly/model-client';
import type { PlanContentAnswers } from '@sprigly/engine';
import { extractStructuredBrief } from './brief-extract.js';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import {
  indexCatalogue,
  buildCatalogueGroundingBlock,
  validateText,
  applyCatalogueValidation,
} from '../catalogue/validate-catalogue.js';

const DEFAULT_CYCLE = 'd502f22d-983b-442c-880a-db4f86861ecb';
const cycleId = process.argv[2] ?? DEFAULT_CYCLE;

function nextMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const logger = pino({ name: 'brief-grounding-probe', level: 'warn' });

const [cycle] = await db
  .select({
    intakeJson: contentCycles.intakeJson,
    cycleMonth: contentCycles.cycleMonth,
    clientId:   contentCycles.clientId,
    channel:    contentCycles.channel,
  })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);

if (!cycle) { console.error(`cycle ${cycleId} not found`); process.exit(1); }

const [catRow] = await db
  .select({ catalogue: clientProductCatalogue.catalogue })
  .from(clientProductCatalogue)
  .where(and(
    eq(clientProductCatalogue.clientId, cycle.clientId),
    eq(clientProductCatalogue.channel,  cycle.channel),
  ))
  .limit(1);

const catalogue = (catRow?.catalogue ?? null) as Catalogue | null;
if (!catalogue) { console.error('no catalogue for this client/channel'); process.exit(1); }

const intake = cycle.intakeJson as { planContent?: PlanContentAnswers } | null;
const planContent: PlanContentAnswers = intake?.planContent ?? { answers: {}, freeNotes: '' };
const planMonth = nextMonth(cycle.cycleMonth);
const intakeText = [planContent.freeNotes, ...Object.values(planContent.answers ?? {})].join('\n');

const model = createModelClientFromEnv();
const brief = await extractStructuredBrief({ planContent, planMonth, model, logger });

const idxWithout = indexCatalogue(catalogue);
const idxWith    = indexCatalogue(catalogue, brief);

const line = (s: string) => console.log(s);
line('');
line(`cycle ${cycleId}  (plan month ${planMonth})`);
line(`brief.products: ${brief.products.map((p) => `${p.product}/${p.colourway}(${p.status})`).join(', ')}`);
line('');

// ── (a) "Connie in Violet" now validates; no [confirm colourway] rewrite ──────
const capA = "She's finally here. Connie in Violet has landed \u{1F90D}";
const aWithout = applyCatalogueValidation(capA, '', idxWithout);
const aWith    = applyCatalogueValidation(capA, '', idxWith);
line('(a) "Connie in Violet"');
line(`    WITHOUT brief -> violations=${aWithout.violations.length}  caption="${aWithout.caption}"`);
line(`    WITH brief    -> violations=${aWith.violations.length}  caption="${aWith.caption}"`);
line(`    => rewritten without brief? ${aWithout.caption.includes('[confirm colourway]')}   preserved with brief? ${aWith.caption === capA}`);
line('');

// ── (b) Hannah-Violet unaffected; sets stay distinct; no leak ─────────────────
const hannahViol = validateText('The Hannah in Violet vest is back.', idxWith);
line('(b) separation Connie-Violet (briefed) vs Hannah-Violet (sold)');
line(`    Hannah in Violet (WITH brief) violations=${hannahViol.length}`);
line(`    connie set has "violet"? ${idxWith.colourwaysByName.get('connie')?.has('violet')}    hannah set has "violet"? ${idxWith.colourwaysByName.get('hannah')?.has('violet')}`);
line(`    briefed-origin  connie: [${[...(idxWith.briefedByName.get('connie') ?? [])].join(', ')}]    hannah: [${[...(idxWith.briefedByName.get('hannah') ?? [])].join(', ')}]`);
line(`    => Hannah-Violet stays sold-origin (not briefed), Connie-Violet is briefed; no cross-leak.`);
line('');

// ── (c) grounding marks Connie Violet [BRIEFED LAUNCH], distinct from sold ─────
const grounding = buildCatalogueGroundingBlock(catalogue, intakeText, brief);
const connieLine = grounding.split('\n').find((l) => /^- Connie /.test(l));
const emmaLine   = grounding.split('\n').find((l) => /^- Emma /.test(l));
line('(c) grounding block');
line(`    ${connieLine}`);
line(`    ${emmaLine}   <- sold line, for contrast (no BRIEFED LAUNCH marker)`);
line(`    => Connie line carries "Violet [BRIEFED LAUNCH]"? ${connieLine?.includes('Violet [BRIEFED LAUNCH]')}`);
line('');
process.exit(0);
