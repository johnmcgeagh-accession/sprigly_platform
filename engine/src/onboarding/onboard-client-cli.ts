/**
 * onboard-client-cli.ts — the "onboard" half of the two-command path.
 *
 * Creates a new app-surface client from a name + Instagram handle, trawls their posts
 * into ig_posts, derives voice / pillars / cadence, defaults categories / register_map,
 * writes them, dumps review files, and STOPS. Generation is the separate trigger-plan CLI.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker onboard-client "<Brand Name>" <handle> [--channel instagram] [--website URL] [--force-thin] [--resume] [--skip-trawl] [--out-dir DIR]
 *   Calibration (files only, no DB writes, no client created):
 *   pnpm --filter @sprigly/worker onboard-client --calibrate ivy-t [--channel instagram] [--out-dir DIR]
 *
 * Spends Bedrock: Stages C (voice) and D (pillars) are model calls. NEVER writes Drive,
 * NEVER touches client_product_catalogue, NEVER mutates an existing client's rows.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { db, clients, voiceSnapshots, clientPlanningConfig } from '@sprigly/db';
import { and } from 'drizzle-orm';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { env } from '../env.js';
import {
  stageCreate, stageTrawl, deriveVoiceProfile, derivePillars, computeCadence, computeFormatMix,
  toConfigPillars, writeVoiceSnapshot, writePlanningConfig, loadIgPostsWindow, stageShopifyCatalogue,
  DEFAULT_CATEGORIES, DEFAULT_REGISTER_MAP, THIN_CAPTION_FLOOR, slugify,
} from './onboard.js';

const logger = pino({ name: 'onboard-client', level: 'info' });

function flag(argv: string[], name: string): string | undefined { const i = argv.indexOf(name); return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined; }
function has(argv: string[], name: string): boolean { return argv.includes(name); }

const argv    = process.argv.slice(2);
const channel = flag(argv, '--channel') ?? 'instagram';
const outBase = flag(argv, '--out-dir') ?? join(tmpdir(), 'sprigly-onboarding');
const model   = createModelClientFromEnv();

function dump(dir: string, file: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(p, content, 'utf-8');
  return p;
}

// ── Calibration mode: run C + D against an existing client's captions, files only ──
async function calibrate(slug: string): Promise<void> {
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.slug, slug)).limit(1);
  if (!client) { console.error(`Calibration: client "${slug}" not found.`); process.exit(1); }

  const win = await loadIgPostsWindow(db, client.id, channel);
  if (win.captions.length === 0) { console.error(`Calibration: no ig_posts captions for ${slug}/${channel}.`); process.exit(1); }
  console.log(`Calibration: ${win.captions.length} captions across ${win.months.length} month(s) for ${slug}.`);

  // Ground truth (read-only) — her real current voice snapshot + configured pillars.
  const [realVoice] = await db.select({ md: voiceSnapshots.snapshotMd }).from(voiceSnapshots)
    .where(and(eq(voiceSnapshots.clientId, client.id), eq(voiceSnapshots.channel, channel), eq(voiceSnapshots.isCurrent, true))).limit(1);
  const [cfg] = await db.select({ pillars: clientPlanningConfig.pillars }).from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, client.id), eq(clientPlanningConfig.channel, channel))).limit(1);

  const voice = await deriveVoiceProfile({ model, captions: win.captions, brandName: client.name, channel });
  const pillars = await derivePillars({ model, captions: win.captions, brandName: client.name });

  const dir = join(outBase, `calibration-${slug}`);
  const paths = {
    derivedVoice:  dump(dir, 'derived-voice.md', voice.voiceDoc),
    realVoice:     dump(dir, 'real-voice.md', realVoice?.md ?? '(no current voice snapshot)'),
    derivedPillars: dump(dir, 'derived-pillars.json', JSON.stringify(pillars.pillars, null, 2)),
    configPillars:  dump(dir, 'config-pillars.json', JSON.stringify(cfg?.pillars ?? [], null, 2)),
    diff:          '',
  };

  // Deterministic STRUCTURAL comparison (no scoring — for human judgment).
  const headings = (s: string) => (s.match(/^#{2,3} .+$/gm) ?? []).map((h) => h.trim());
  const derivedH = headings(voice.voiceDoc);
  const realH = headings(realVoice?.md ?? '');
  const configPillarNames = ((cfg?.pillars as Array<{ name?: string }> | undefined) ?? []).map((p) => p.name).filter(Boolean);
  const diff = [
    `# Calibration structural comparison — ${slug} (${channel})`,
    '',
    `Captions analysed: ${win.captions.length}   Months: ${win.months.join(', ')}`,
    '',
    '## Voice — section headings',
    `Derived (${derivedH.length}): ${derivedH.join(' | ') || '(none)'}`,
    `Real    (${realH.length}): ${realH.join(' | ') || '(none)'}`,
    `Derived voice length: ${voice.voiceDoc.length} chars; real: ${(realVoice?.md ?? '').length} chars.`,
    '',
    '## Pillars — names side by side',
    `Derived (${pillars.pillars.length}): ${pillars.pillars.map((p) => `${p.name} (${p.sharePct}%)`).join(' | ')}`,
    `Configured (${configPillarNames.length}): ${configPillarNames.join(' | ') || '(none)'}`,
    '',
    'This is a structural comparison only — read derived-voice.md against real-voice.md and the two pillar files to judge what the derivation captured, missed, or invented.',
  ].join('\n');
  paths.diff = dump(dir, 'DIFF-SUMMARY.md', diff);

  console.log('\nCalibration files (NO DB writes):');
  for (const [k, v] of Object.entries(paths)) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`\nBedrock: 2 model calls — voice(in=${voice.usage.inputTokens},out=${voice.usage.outputTokens}) pillars(in=${pillars.usage.inputTokens},out=${pillars.usage.outputTokens}) model=${voice.usage.modelId}`);
  process.exit(0);
}

// ── Normal onboarding ─────────────────────────────────────────────────────────
async function onboard(): Promise<void> {
  const name   = argv[0];
  const handle = argv[1];
  const website = flag(argv, '--website');
  const forceThin = has(argv, '--force-thin');
  const resume    = has(argv, '--resume');     // reuse an existing client (skip Stage A)
  const skipTrawl = has(argv, '--skip-trawl'); // re-derive from existing ig_posts (skip Stage B)

  if (!name || name.startsWith('--') || !handle || handle.startsWith('--')) {
    console.error('Usage: pnpm --filter @sprigly/worker onboard-client "<Brand Name>" <handle> [--channel instagram] [--website URL] [--force-thin] [--resume] [--skip-trawl] [--out-dir DIR]');
    console.error('   or: pnpm --filter @sprigly/worker onboard-client --calibrate <slug> [--channel instagram]');
    process.exit(1);
  }

  // Stage A — create (or resume an existing client).
  let clientId: string; let slug: string;
  if (resume) {
    slug = slugify(name);
    const [existing] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
    if (!existing) { console.error(`--resume: no client with slug "${slug}".`); process.exit(1); }
    clientId = existing.id;
    console.log(`A create : resumed existing client ${slug} (${clientId}).`);
  } else {
    const a = await stageCreate({ db, name, handle, channel, website });
    if (!a.ok) { console.error(`A create : ✗ ${a.message}`); process.exit(1); }
    clientId = a.clientId!; slug = a.slug!;
    console.log(`A create : ✓ ${a.message}`);
  }

  // Stage B — trawl (or reuse existing ig_posts).
  let captions: string[]; let timestamps: string[]; let mediaTypes: string[];
  if (skipTrawl) {
    const win = await loadIgPostsWindow(db, clientId, channel);
    captions = win.captions; timestamps = win.timestamps; mediaTypes = win.mediaTypes;
    console.log(`B trawl  : skipped — reusing ${win.postCount} posts (${captions.length} captions, ${mediaTypes.length} with media type) from ig_posts.`);
  } else {
    const cleanHandle = handle.replace(/^@/, '').trim();
    const b = await stageTrawl({ db, apifyApiKey: env.APIFY_API_KEY, clientId, channel, handle: cleanHandle, logger });
    if (!b.ok) { console.error(`B trawl  : ✗ ${b.message}`); process.exit(1); }
    console.log(`B trawl  : ✓ ${b.message}`);
    captions = b.captions; timestamps = b.timestamps; mediaTypes = b.mediaTypes;
    if (b.thin && !forceThin) {
      console.error(`\n⚠️  THIN ACCOUNT: only ${captions.length} captions (floor is ${THIN_CAPTION_FLOOR}). Voice, pillars and cadence will ALL be weak and unreliable.`);
      console.error(`    Client + ig_posts are created. Re-run with --resume --force-thin to derive anyway, or trawl a fuller account.`);
      process.exit(2);
    }
  }

  // Stages C-F.
  const voice   = await deriveVoiceProfile({ model, captions, brandName: name, channel });
  const pillars = await derivePillars({ model, captions, brandName: name });
  const cadence = computeCadence(timestamps);
  const mix     = computeFormatMix(mediaTypes);
  const mixLine = mix.counted > 0
    ? `image ${mix.imagePct}% / reel ${mix.reelPct}% / carousel ${mix.carouselPct}% (over ${mix.counted} typed posts)`
    : 'unknown (no media type on the trawled posts)';

  const voiceSnapshotId = await writeVoiceSnapshot(db, clientId, channel, voice.voiceDoc);
  await writePlanningConfig(db, clientId, channel, {
    pillars: toConfigPillars(pillars.pillars), cadence: cadence.cadence,
    categories: DEFAULT_CATEGORIES, registerMap: DEFAULT_REGISTER_MAP,
  });

  // Stage G — optional Shopify catalogue from the client's website (--website).
  let catalogueLine = 'not requested (pass --website to fetch a Shopify catalogue)';
  if (website) {
    const g = await stageShopifyCatalogue({ db, clientId, channel, website, logger });
    catalogueLine = g.skipped
      ? `skipped — ${g.message}`
      : `${g.familyCount} products / ${g.variantCount} variants (source=shopify-web); sample: ${g.sampleNames.join(', ')}`;
    console.log(`G shopify: ${g.skipped ? '○' : '✓'} ${g.message}`);
    if (!g.skipped) console.log(`  sample : ${g.sampleNames.join(', ')}`);
  }

  const dir = join(outBase, slug);
  const voicePath   = dump(dir, 'voice.md', voice.voiceDoc);
  const pillarsPath = dump(dir, 'pillars.json', JSON.stringify(pillars.pillars, null, 2));

  const summary = [
    `# Onboarding review — ${name} (${slug} / ${channel})`,
    '',
    `- client id            : ${clientId}   (delivery_surface=app, no Drive)`,
    `- voice_snapshots (id) : ${voiceSnapshotId}   reason=onboarding-derived, is_current=true`,
    `- client_planning_config: pillars=${pillars.pillars.length}, categories=${DEFAULT_CATEGORIES.length} (default set), register_map={} (lenient default)`,
    `- cadence (observed)   : ~${cadence.observedPostsPerWeek}/week over ~${cadence.windowDays} days (${cadence.postCount} posts) → suggested ${JSON.stringify(cadence.cadence)}`,
    `- format mix (observed): ${mixLine}`,
    `- product catalogue    : ${catalogueLine}`,
    '',
    `Pillars: ${pillars.pillars.map((p) => `${p.name} (${p.sharePct}%)`).join(', ')}`,
    `Categories (default): ${DEFAULT_CATEGORIES.join(', ')}`,
    '',
    `Review files:`,
    `  voice   : ${voicePath}`,
    `  pillars : ${pillarsPath}`,
    '',
    `NEXT STEP: review + edit the voice snapshot / planning config if needed, then generate a sample plan:`,
    `  pnpm --filter @sprigly/worker trigger-plan ${slug} ${channel} --plan-month YYYY-MM`,
  ].join('\n');
  const summaryPath = dump(dir, 'review-summary.md', summary);

  console.log(`C voice  : ✓ voice_snapshots ${voiceSnapshotId} (${voice.voiceDoc.length} chars)`);
  console.log(`D pillars: ✓ ${pillars.pillars.length} pillars → client_planning_config`);
  console.log(`E cadence: ✓ ~${cadence.observedPostsPerWeek}/week → ${JSON.stringify(cadence.cadence)}`);
  console.log(`  format : ${mixLine}`);
  console.log(`F default: ✓ categories(${DEFAULT_CATEGORIES.length}), register_map={}`);
  console.log(`\n${summary}`);
  console.log(`\n(review-summary written to ${summaryPath})`);
  console.log(`Bedrock: 2 model calls — voice(in=${voice.usage.inputTokens},out=${voice.usage.outputTokens}) pillars(in=${pillars.usage.inputTokens},out=${pillars.usage.outputTokens})`);
  process.exit(0);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const calSlug = flag(argv, '--calibrate');
if (calSlug) { await calibrate(calSlug); } else { await onboard(); }
