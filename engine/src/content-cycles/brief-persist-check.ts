/**
 * brief-persist-check.ts — Phase 3a null-safety verification.
 *
 * Proves the persistence path degrades to prior behaviour:
 *   (1) an EMPTY brief extracts to the empty structure with NO model call,
 *   (2) grounding is identical for no-brief / null / empty,
 *   (3) the hard-validation index is identical for no-brief / null / empty,
 *       and briefedByName is empty in all three.
 *
 * READ-ONLY: one explicit-column catalogue read, no model call (a throwing mock
 * proves the no-call path), no write, no 0058 needed. NOT for committing.
 *
 * Run:
 *   cd engine && set -a && . ../.env.local && set +a && \
 *     pnpm exec tsx src/content-cycles/brief-persist-check.ts [cycleId]
 */

import { eq, and } from 'drizzle-orm';
import { db, contentCycles, clientProductCatalogue } from '@sprigly/db';
import type { ModelClient } from '@sprigly/model-client';
import type { PlanContentAnswers } from '@sprigly/engine';
import type { Catalogue } from '../catalogue/parse-catalogue.js';
import { indexCatalogue, buildCatalogueGroundingBlock, type CatalogueIndex } from '../catalogue/validate-catalogue.js';
import { extractStructuredBrief, EMPTY_STRUCTURED_BRIEF } from './brief-extract.js';

const cycleId = process.argv[2] ?? 'd502f22d-983b-442c-880a-db4f86861ecb';

const [cycle] = await db
  .select({ intakeJson: contentCycles.intakeJson, clientId: contentCycles.clientId, channel: contentCycles.channel })
  .from(contentCycles)
  .where(eq(contentCycles.id, cycleId))
  .limit(1);
if (!cycle) { console.error(`cycle ${cycleId} not found`); process.exit(1); }

const [catRow] = await db
  .select({ catalogue: clientProductCatalogue.catalogue })
  .from(clientProductCatalogue)
  .where(and(eq(clientProductCatalogue.clientId, cycle.clientId), eq(clientProductCatalogue.channel, cycle.channel)))
  .limit(1);
const catalogue = (catRow?.catalogue ?? null) as Catalogue | null;
if (!catalogue) { console.error('no catalogue'); process.exit(1); }

const planContent = (cycle.intakeJson as { planContent?: PlanContentAnswers } | null)?.planContent ?? { answers: {}, freeNotes: '' };
const intakeText = [planContent.freeNotes, ...Object.values(planContent.answers ?? {})].join('\n');

// (1) empty brief -> empty structure, NO model call (throwing mock proves it)
const throwingModel: ModelClient = {
  complete:          async () => { throw new Error('MODEL CALLED — should not happen for an empty brief'); },
  completeStreaming: async () => { throw new Error('MODEL CALLED — should not happen for an empty brief'); },
};
let noModelCall = false;
let emptyResult: unknown = null;
try {
  emptyResult = await extractStructuredBrief({ planContent: { answers: {}, freeNotes: '' }, planMonth: '2026-07', model: throwingModel });
  noModelCall = true;
} catch { noModelCall = false; }
const equalsEmpty = JSON.stringify(emptyResult) === JSON.stringify(EMPTY_STRUCTURED_BRIEF);

// (2) grounding identical: no-brief / null / empty
const g0 = buildCatalogueGroundingBlock(catalogue, intakeText);
const gNull = buildCatalogueGroundingBlock(catalogue, intakeText, null);
const gEmpty = buildCatalogueGroundingBlock(catalogue, intakeText, EMPTY_STRUCTURED_BRIEF);
const groundingSame = g0 === gNull && gNull === gEmpty;

// (3) index identical: no-brief / null / empty; briefedByName empty
const serialize = (idx: CatalogueIndex) =>
  JSON.stringify([...idx.colourwaysByName.entries()].map(([k, v]) => [k, [...v].sort()]).sort());
const i0 = indexCatalogue(catalogue);
const iNull = indexCatalogue(catalogue, null);
const iEmpty = indexCatalogue(catalogue, EMPTY_STRUCTURED_BRIEF);
const indexSame = serialize(i0) === serialize(iNull) && serialize(iNull) === serialize(iEmpty);
const briefedEmpty = i0.briefedByName.size === 0 && iNull.briefedByName.size === 0 && iEmpty.briefedByName.size === 0;

console.log('');
console.log(`(1) empty brief -> no model call: ${noModelCall}   equals EMPTY structure: ${equalsEmpty}`);
console.log(`(2) grounding identical (no-brief === null === empty): ${groundingSame}`);
console.log(`(3) index identical (no-brief === null === empty): ${indexSame}   briefedByName empty in all: ${briefedEmpty}`);
const allPass = noModelCall && equalsEmpty && groundingSame && indexSame && briefedEmpty;
console.log('');
console.log(allPass ? 'NULL-SAFE: PASS — a cycle with no/empty brief reads and plans exactly as before.' : 'FAIL');
process.exit(allPass ? 0 : 1);
