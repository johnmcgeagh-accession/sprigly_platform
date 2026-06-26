/**
 * voice-batch-merge.ts — daily batched Sonnet merge for voice_edits.
 *
 * Called on a 24-hour cron (and manually via pnpm merge-voice).
 * For each (clientId, channel) that has pending voice_edits (ingested_at IS NULL):
 *   1. Claim the pending rows.
 *   2. Load current voice snapshot.
 *   3. ONE streaming Sonnet call returning a JSON delta array (v3 prompt).
 *      Fallback: if editCount > 30, call in slices of 5, dedup, then apply once.
 *   4. Parse and validate delta JSON. Hard-fail on max_tokens (truncated JSON).
 *   5. Apply voice deltas to the channel block's ### Derived rules section.
 *   6. Atomic transaction: flip is_current, insert run + snapshot, mark edits ingested.
 *   7a. Regenerate Drive voice.md (non-fatal).
 *   7b. Route factual deltas to client-facts.md (non-fatal, client-scoped folder).
 *
 * Model: Sonnet via completeStreaming() — resolves the 180s socket timeout by
 * keeping the connection alive with streaming chunks. The 30s inter-chunk watchdog
 * in BedrockClient catches mid-stream stalls.
 *
 * Failure behaviour: per-channel errors are logged and skipped; edits stay pending
 * and are retried the next night. No run row is created on failure.
 */

import { eq, and, isNull, inArray, asc } from 'drizzle-orm';
import {
  db as _db,
  voiceEdits,
  voiceIngestionRuns,
  voiceSnapshots,
  clientChannels,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { DbPromptResolver } from '@sprigly/prompts';
import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import type { VoiceSnapshot, VoiceEdit } from '@sprigly/db';
import {
  fillTemplate,
  formatEditSummary,
  validateMergedBlock,
  updateVoiceMdOnDrive,
  MERGE_PROMPT_VARS_KEYS,
} from './voice-consumer.js';

type Db = typeof _db;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RuleDelta {
  rule:           string;
  evidence:       { before: string; after: string };
  type:           'voice' | 'factual';
  action:         'add' | 'update' | 'remove';
  targetSection?: string;  // required for update/remove; absent for add
  targetQuote?:   string;  // required for update/remove; absent for add
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const BATCH_THRESHOLD         = 30;   // above this, split into slices
export const BATCH_SIZE              = 5;    // edits per slice when batching
const MATCH_THRESHOLD         = 0.3;  // min Jaccard for update/remove matching
const DERIVED_HEADING         = '### Derived rules';
export const DELTA_MAX_TOKENS_SINGLE = 4000; // headroom for up to ~19 edits in one call
export const DELTA_MAX_TOKENS_SLICE  = 1500; // per 5-edit batch slice

// ── Text-matching helpers (for update/remove bullet matching) ─────────────────

function normaliseWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Strips the "[YYYY-MM · action] " prefix so matching operates on rule text only.
function extractRuleText(bullet: string): string {
  return bullet.replace(/^-\s*\[\d{4}-\d{2}[^\]]*\]\s*/, '').trim();
}

// ── Delta JSON parsing ────────────────────────────────────────────────────────

function parseDeltaResponse(
  raw: string,
  logger: Logger,
  logCtx: { clientId: string; channel: string },
): RuleDelta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(`Sonnet returned non-JSON output (length=${raw.length}): ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Sonnet returned non-array JSON: ${raw.slice(0, 200)}`);
  }
  const valid: RuleDelta[] = [];
  for (const item of parsed) {
    const i = item as Record<string, unknown>;
    if (
      typeof i !== 'object' || i === null ||
      typeof i['rule']   !== 'string' ||
      (i['type']   !== 'voice'  && i['type']   !== 'factual') ||
      (i['action'] !== 'add'    && i['action'] !== 'update' && i['action'] !== 'remove')
    ) {
      logger.warn({ ...logCtx, item: JSON.stringify(item) }, 'voice-batch-merge: dropping malformed delta');
      continue;
    }
    const ev = i['evidence'];
    if (typeof ev !== 'object' || ev === null || typeof (ev as Record<string, unknown>)['before'] !== 'string') {
      logger.warn({ ...logCtx, item: JSON.stringify(item) }, 'voice-batch-merge: dropping delta missing evidence.before');
      continue;
    }
    if ((i['action'] === 'update' || i['action'] === 'remove') && typeof i['targetSection'] !== 'string') {
      logger.warn({ ...logCtx, item: JSON.stringify(item) }, 'voice-batch-merge: update/remove missing targetSection — dropping delta');
      continue;
    }
    if (i['action'] === 'add') {
      delete i['targetSection'];
      delete i['targetQuote'];
    }
    valid.push(item as RuleDelta);
  }
  return valid;
}

// ── Deduplication (for >30-edit batching path only) ──────────────────────────

// Last-write-wins by normalised rule text. Preserves insertion order of first
// occurrence; a later slice overwrites the action/evidence for the same rule.
function deduplicateDeltas(deltas: RuleDelta[]): RuleDelta[] {
  const seen = new Map<string, number>();
  const result: RuleDelta[] = [];
  for (const delta of deltas) {
    const key = delta.rule.toLowerCase().trim();
    const idx = seen.get(key);
    if (idx !== undefined) {
      result[idx] = delta;
    } else {
      seen.set(key, result.length);
      result.push(delta);
    }
  }
  return result;
}

// ── Section-aware delta application helpers ───────────────────────────────────

// Strips non-alphanumeric characters for fuzzy substring comparison.
// Handles cases where the profile line has embedded punctuation the model omits
// (e.g. "Sunday Style" matches **"Sunday Style" format…**).
const SCRUB_NON_ALPHA = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Locates the character range of a specific line within a named ### section.
// Pass 1:  exact case-insensitive substring.
// Pass 1b: normalized substring (strips punctuation/quotes).
// Pass 2:  Jaccard on ≥5-char words, threshold 0.3.
function findSectionAndLine(
  block: string,
  targetSection: string,
  targetQuote: string,
): { lineStart: number; lineEnd: number; line: string } | null {
  const pattern = new RegExp(`\\n### ${escapeRegex(targetSection)}[ \\t]*\\n`, 'i');
  const headingMatch = pattern.exec(block);
  if (!headingMatch) return null;

  const contentStart  = headingMatch.index + headingMatch[0].length;
  const nextSection   = block.indexOf('\n### ', contentStart);
  const contentEnd    = nextSection === -1 ? block.length : nextSection;
  const sectionLines  = block.slice(contentStart, contentEnd).split('\n');

  const normalQuote   = targetQuote.toLowerCase().trim();
  const scrubbedQuote = SCRUB_NON_ALPHA(targetQuote);

  let offset = contentStart;

  // Pass 1 — exact case-insensitive substring
  for (const line of sectionLines) {
    if (normalQuote.length > 0 && line.toLowerCase().includes(normalQuote)) {
      return { lineStart: offset, lineEnd: offset + line.length, line };
    }
    offset += line.length + 1;
  }

  // Pass 1b — normalized substring (strips punctuation so quoted phrases still match)
  offset = contentStart;
  for (const line of sectionLines) {
    if (scrubbedQuote.length > 0 && SCRUB_NON_ALPHA(line).includes(scrubbedQuote)) {
      return { lineStart: offset, lineEnd: offset + line.length, line };
    }
    offset += line.length + 1;
  }

  // Pass 2 — Jaccard on ≥5-char words (threshold 0.3)
  const quoteWords = normaliseWords(targetQuote);
  if (quoteWords.size === 0) return null;

  offset = contentStart;
  let bestScore = -1, bestStart = -1, bestEnd = -1, bestLine = '';
  for (const line of sectionLines) {
    if (line.trim().length > 0) {
      const score = jaccard(quoteWords, normaliseWords(line));
      if (score > bestScore && score >= MATCH_THRESHOLD) {
        bestScore = score; bestStart = offset; bestEnd = offset + line.length; bestLine = line;
      }
    }
    offset += line.length + 1;
  }
  return bestStart !== -1 ? { lineStart: bestStart, lineEnd: bestEnd, line: bestLine } : null;
}

// Guards against a loose targetQuote matching the wrong line.
// Requires evidence.before to also appear in the candidate line (substring or Jaccard).
function confirmEvidence(line: string, evidenceBefore: string): boolean {
  const normalBefore = evidenceBefore.toLowerCase().trim();
  if (normalBefore.length === 0) return false;
  if (line.toLowerCase().includes(normalBefore)) return true;
  const scrubbed = SCRUB_NON_ALPHA(evidenceBefore);
  if (scrubbed.length > 0 && SCRUB_NON_ALPHA(line).includes(scrubbed)) return true;
  const beforeWords = normaliseWords(evidenceBefore);
  if (beforeWords.size === 0) return false;
  return jaccard(beforeWords, normaliseWords(line)) >= MATCH_THRESHOLD;
}

function appendToDerivedRules(block: string, bullet: string): string {
  const pos = block.indexOf('\n' + DERIVED_HEADING);
  if (pos === -1) return `${block.trimEnd()}\n\n${DERIVED_HEADING}\n\n${bullet}\n`;
  return `${block.trimEnd()}\n${bullet}\n`;
}

// ── Voice delta application ───────────────────────────────────────────────────

export function applyVoiceDeltas(
  channelBlock: string,
  voiceDeltas: RuleDelta[],
  monthLabel: string,
  logger: Logger,
  logCtx: { clientId: string; channel: string },
): string {
  if (voiceDeltas.length === 0) return channelBlock;

  let block = channelBlock;

  for (const delta of voiceDeltas) {
    if (delta.action === 'add') {
      block = appendToDerivedRules(block, `- [${monthLabel} · added] ${delta.rule}`);
      continue;
    }

    // update / remove: re-search the evolving block on each iteration — do NOT hoist
    // findSectionAndLine out of the loop. Sequential in-place mutations shift character
    // offsets, so each search must operate on the current block state.
    const hit = delta.targetSection
      ? findSectionAndLine(block, delta.targetSection, delta.targetQuote ?? '')
      : null;

    if (hit === null) {
      logger.warn(
        { ...logCtx, action: delta.action, targetSection: delta.targetSection, targetQuote: delta.targetQuote },
        'voice-batch-merge: targetSection/targetQuote not found in block',
      );
      if (delta.action === 'update') {
        block = appendToDerivedRules(block, `- [${monthLabel} · added] ${delta.rule}`);
      }
      continue;
    }

    // Mismatch guard: evidence.before must also appear in the matched line before
    // any mutation. Prevents a loose targetQuote from corrupting a wrong line.
    // Logs every mismatch so we can track how often the model's targetQuote is off.
    if (!confirmEvidence(hit.line, delta.evidence.before)) {
      logger.warn(
        {
          ...logCtx,
          action: delta.action,
          targetSection: delta.targetSection,
          targetQuote: delta.targetQuote,
          evidenceBefore: delta.evidence.before,
          matchedLine: hit.line.trim().slice(0, 80),
        },
        'voice-batch-merge: evidence.before not confirmed in matched line — falling back to Derived rules',
      );
      if (delta.action === 'update') {
        block = appendToDerivedRules(block, `- [${monthLabel} · added] ${delta.rule}`);
      }
      continue;
    }

    if (delta.action === 'update') {
      // Only update plain-bullet lines in-place; blockquotes and bold narrative
      // paragraphs route to Derived rules to avoid corrupting section formatting.
      if (!/^\s*[-*•]\s/.test(hit.line)) {
        logger.warn(
          { ...logCtx, targetSection: delta.targetSection, matchedLine: hit.line.trim().slice(0, 60) },
          'voice-batch-merge: update matched non-bullet line — routing to Derived rules',
        );
        block = appendToDerivedRules(block, `- [${monthLabel} · added] ${delta.rule}`);
        continue;
      }
      // Preserve a leading bold label (e.g. "- **DM invitation:** ") to keep section
      // texture; fall back to plain bullet prefix when no colon-terminated label exists.
      const boldLabel = hit.line.match(/^(\s*[-*•]\s*\*\*[^*]+\*\*:?\s+)/)?.[1];
      const prefix    = boldLabel ?? (hit.line.match(/^(\s*[-*•]\s*)/)?.[1] ?? '');
      block = block.slice(0, hit.lineStart) + prefix + delta.rule + block.slice(hit.lineEnd);
    } else {
      // remove: delete the line and its trailing newline
      const deleteEnd = hit.lineEnd < block.length && block[hit.lineEnd] === '\n'
        ? hit.lineEnd + 1 : hit.lineEnd;
      block = block.slice(0, hit.lineStart) + block.slice(deleteEnd);
    }
  }

  return block;
}

// ── Factual delta routing ─────────────────────────────────────────────────────

// client-facts.md is per-client (clientId-scoped), not per-channel.
// The Drive folder is resolved by the caller to the client-canonical folder
// (first-alphabetical channel's folder), so this function doesn't need to query the DB.
export async function routeFactualDeltasToDrive(
  drive:               DriveApiClient,
  clientFolderDriveId: string,
  channelTitle:        string,
  factualDeltas:       RuleDelta[],
  monthLabel:          string,
  logger:              Logger,
  logCtx:              { clientId: string; channel: string },
): Promise<void> {
  if (factualDeltas.length === 0) return;

  const folderFiles = await drive.listFiles(clientFolderDriveId);
  const existing    = folderFiles.find((f) => f.name === 'client-facts.md');

  let currentContent = '';
  let fileId: string | undefined;

  if (existing) {
    const buf  = await drive.downloadFile(existing.id);
    currentContent = buf.toString('utf-8');
    fileId = existing.id;
  }

  const newSection = [
    `\n## ${channelTitle} — ${monthLabel}\n`,
    ...factualDeltas.map((d) =>
      `- ${d.rule}\n  Before: "${d.evidence.before}"\n  After:  "${d.evidence.after}"`,
    ),
  ].join('\n');

  const updatedContent = (currentContent.trimEnd() + '\n' + newSection).trimStart() + '\n';
  const content        = Buffer.from(updatedContent, 'utf-8');

  if (fileId) {
    await drive.updateFile(fileId, 'text/plain; charset=utf-8', content);
  } else {
    await drive.createFile(clientFolderDriveId, 'client-facts.md', 'text/plain; charset=utf-8', content);
  }

  logger.info(
    { ...logCtx, factualDeltaCount: factualDeltas.length },
    'voice-batch-merge: client-facts.md updated',
  );
}

// ── Model call ────────────────────────────────────────────────────────────────

export async function callModelForDeltas(
  batch:               VoiceEdit[],
  channelTitle:        string,
  currentVoiceProfile: string,
  promptTemplate:      string,
  model:               ModelClient,
  audit:               AuditLogger,
  clientId:            string,
  months:              string,
  maxTokens:           number,
  logCtx:              { clientId: string; channel: string },
  logger:              Logger,
): Promise<RuleDelta[]> {
  const mergeVars: Record<typeof MERGE_PROMPT_VARS_KEYS[number], string> = {
    channelTitle,
    currentVoiceProfile,
    editSummary: formatEditSummary(batch),
  };
  const mergePrompt = fillTemplate(promptTemplate, mergeVars);

  const result = await model.completeStreaming({
    model:     'sonnet',
    messages:  [{ role: 'user', content: mergePrompt }],
    maxTokens,
  });

  try {
    await audit.logModelCall({
      clientId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       'voice-ingest:merge',
      metadata:     { batchEditCount: batch.length, months },
    });
  } catch (auditErr) {
    logger.warn({ ...logCtx, err: String(auditErr) }, 'voice-batch-merge: audit log failed — non-fatal');
  }

  if (result.stopReason === 'max_tokens') {
    logger.error(
      { ...logCtx, stopReason: result.stopReason, outputTokens: result.outputTokens },
      'voice-batch-merge: Sonnet output truncated (max_tokens reached) — edits stay pending',
    );
    throw new Error('Sonnet delta output truncated by max_tokens — JSON is incomplete');
  }

  return parseDeltaResponse(result.content, logger, logCtx);
}

// ── Batch extraction (shared by mergeChannelEdits + cycle extract phase) ─────

/** Single call for ≤30 edits; sliced+deduped for >30. */
export async function extractDeltasFromEdits(
  batch:               VoiceEdit[],
  channelTitle:        string,
  currentVoiceProfile: string,
  promptTemplate:      string,
  model:               ModelClient,
  audit:               AuditLogger,
  clientId:            string,
  months:              string,
  logCtx:              { clientId: string; channel: string },
  logger:              Logger,
): Promise<RuleDelta[]> {
  if (batch.length > BATCH_THRESHOLD) {
    const collected: RuleDelta[] = [];
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const slice = batch.slice(i, i + BATCH_SIZE);
      try {
        const sliceDeltas = await callModelForDeltas(
          slice, channelTitle, currentVoiceProfile, promptTemplate,
          model, audit, clientId, months, DELTA_MAX_TOKENS_SLICE, logCtx, logger,
        );
        collected.push(...sliceDeltas);
      } catch (err) {
        throw new Error(
          `voice-batch-merge: batch slice [${i}–${Math.min(i + BATCH_SIZE, batch.length) - 1}] of ${batch.length} failed: ${String(err)}`,
        );
      }
    }
    const allDeltas = deduplicateDeltas(collected);
    logger.info(
      { ...logCtx, editCount: batch.length, rawDeltaCount: collected.length, dedupedDeltaCount: allDeltas.length },
      'voice-batch-merge: deltas deduped after batch slicing',
    );
    return allDeltas;
  }
  return callModelForDeltas(
    batch, channelTitle, currentVoiceProfile, promptTemplate,
    model, audit, clientId, months, DELTA_MAX_TOKENS_SINGLE, logCtx, logger,
  );
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runVoiceBatchMerge(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  model: ModelClient,
  prompts: DbPromptResolver,
  audit: AuditLogger,
  logger: Logger,
): Promise<void> {
  const pendingGroups = await db
    .selectDistinct({ clientId: voiceEdits.clientId, channel: voiceEdits.channel })
    .from(voiceEdits)
    .where(isNull(voiceEdits.ingestedAt));

  if (pendingGroups.length === 0) {
    logger.info('voice-batch-merge: no pending edits — skipping');
    return;
  }

  logger.info({ groupCount: pendingGroups.length }, 'voice-batch-merge: starting batch');

  let succeeded = 0;
  let failed    = 0;

  for (const { clientId, channel } of pendingGroups) {
    try {
      await mergeChannelEdits(
        clientId, channel, db, encProvider,
        googleClientId, googleClientSecret,
        model, prompts, audit, logger,
      );
      succeeded++;
    } catch (err) {
      failed++;
      logger.error({ clientId, channel, err: String(err) }, 'voice-batch-merge: channel merge failed — edits stay pending');
    }
  }

  logger.info({ succeeded, failed, total: pendingGroups.length }, 'voice-batch-merge: done');
}

// ── Per-channel merge ─────────────────────────────────────────────────────────

async function mergeChannelEdits(
  clientId:          string,
  channel:           string,
  db:                Db,
  encProvider:       EncryptionProvider,
  googleClientId:    string,
  googleClientSecret: string,
  model:             ModelClient,
  prompts:           DbPromptResolver,
  audit:             AuditLogger,
  logger:            Logger,
): Promise<void> {
  const logCtx = { clientId, channel };

  // ── 1. Claim pending edits ────────────────────────────────────────────────
  const batch = await db
    .select()
    .from(voiceEdits)
    .where(and(
      eq(voiceEdits.clientId, clientId),
      eq(voiceEdits.channel, channel),
      isNull(voiceEdits.ingestedAt),
    ));

  if (batch.length === 0) return; // race: already claimed by a concurrent run

  const batchIds  = batch.map((e) => e.id);
  const months    = [...new Set(batch.map((e) => e.month))].sort().join(', ');
  const startedAt = new Date();

  logger.info({ ...logCtx, editCount: batch.length, months }, 'voice-batch-merge: processing channel');

  // ── 2. Load current snapshot ──────────────────────────────────────────────
  const snapshotRows = await db
    .select()
    .from(voiceSnapshots)
    .where(and(
      eq(voiceSnapshots.clientId, clientId),
      eq(voiceSnapshots.channel, channel),
      eq(voiceSnapshots.isCurrent, true),
    ))
    .limit(1);

  const currentSnapshot: VoiceSnapshot | undefined = snapshotRows[0];
  const currentVoiceProfile = currentSnapshot?.snapshotMd
    ?? '(none — this is the first voice profile for this channel)';

  // ── 3. Load Drive folder IDs ──────────────────────────────────────────────
  const channelRows = await db
    .select({ driveFolderId: clientChannels.driveFolderId })
    .from(clientChannels)
    .where(and(
      eq(clientChannels.clientId, clientId),
      eq(clientChannels.channel, channel),
    ))
    .limit(1);

  const driveFolderId = channelRows[0]?.driveFolderId;
  if (!driveFolderId) {
    throw new Error(`voice-batch-merge: no drive_folder_id for ${clientId}/${channel}`);
  }

  // Resolve the client-canonical folder for cross-channel docs (client-facts.md).
  // Uses the first-alphabetical channel's folder for a deterministic, stable location.
  const allChannelRows = await db
    .select({ driveFolderId: clientChannels.driveFolderId })
    .from(clientChannels)
    .where(eq(clientChannels.clientId, clientId))
    .orderBy(asc(clientChannels.channel));

  const clientFolderDriveId = allChannelRows[0]?.driveFolderId ?? driveFolderId;

  // ── 4. Extract deltas ─────────────────────────────────────────────────────
  const channelTitle   = channel.charAt(0).toUpperCase() + channel.slice(1);
  const promptTemplate = await prompts.resolve(clientId, 'voice-ingest', 'merge');

  logger.info({ ...logCtx, editCount: batch.length }, 'voice-batch-merge: calling Sonnet for merge');

  const allDeltas = await extractDeltasFromEdits(
    batch, channelTitle, currentVoiceProfile, promptTemplate,
    model, audit, clientId, months, logCtx, logger,
  );

  const voiceDeltas   = allDeltas.filter((d) => d.type === 'voice');
  const factualDeltas = allDeltas.filter((d) => d.type === 'factual');
  logger.info(
    { ...logCtx, editCount: batch.length, deltaCount: allDeltas.length,
      voiceDeltaCount: voiceDeltas.length, factualDeltaCount: factualDeltas.length },
    'voice-batch-merge: deltas extracted',
  );

  // ── 5. Apply voice deltas → new channel block ─────────────────────────────
  const baseBlock       = currentSnapshot?.snapshotMd ?? `## ${channelTitle} — Voice Profile\n`;
  const newChannelBlock = applyVoiceDeltas(baseBlock, voiceDeltas, months, logger, logCtx);
  validateMergedBlock(newChannelBlock, channelTitle); // throws → edits stay pending

  // ── 6. Atomic transaction ─────────────────────────────────────────────────
  // FK constraint order:
  //   a) flip prior is_current → false  (unblocks partial unique index)
  //   b) INSERT voice_ingestion_runs    (snapshot_id=null, status='running')
  //   c) INSERT voice_snapshots         (run_id=runId, is_current=true)
  //   d) UPDATE voice_ingestion_runs    (snapshot_id=snapshotId, status='applied')
  //   e) UPDATE voice_edits             (ingested_at=now(), ingestion_run_id=runId)
  let newSnapshotId: string;
  await db.transaction(async (tx) => {
    if (currentSnapshot) {
      await tx
        .update(voiceSnapshots)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(eq(voiceSnapshots.id, currentSnapshot.id));
    }

    const [runRow] = await tx
      .insert(voiceIngestionRuns)
      .values({
        clientId,
        channel,
        month:     months,
        status:    'running',
        editCount: batch.length,
        startedAt,
      })
      .returning({ id: voiceIngestionRuns.id });

    if (!runRow) throw new Error('Failed to insert voice_ingestion_runs row');
    const runId = runRow.id;

    const [newSnapshotRow] = await tx
      .insert(voiceSnapshots)
      .values({
        clientId,
        channel,
        snapshotMd:  newChannelBlock,
        reason:      'monthly-ingest',
        sourceMonth: months,
        runId,
        isCurrent:   true,
      })
      .returning({ id: voiceSnapshots.id });

    if (!newSnapshotRow) throw new Error('Failed to insert voice_snapshots row');
    newSnapshotId = newSnapshotRow.id;

    await tx
      .update(voiceIngestionRuns)
      .set({
        status:     'applied',
        snapshotId: newSnapshotId,
        endedAt:    new Date(),
        updatedAt:  new Date(),
      })
      .where(eq(voiceIngestionRuns.id, runId));

    await tx
      .update(voiceEdits)
      .set({
        ingestedAt:     new Date(),
        ingestionRunId: runId,
        updatedAt:      new Date(),
      })
      .where(inArray(voiceEdits.id, batchIds));
  });

  logger.info({ ...logCtx, newSnapshotId: newSnapshotId! }, 'voice-batch-merge: snapshot committed');

  // ── 7. Post-commit Drive updates (both non-fatal) ─────────────────────────
  const tokens = await getTokens(db, encProvider, clientId, 'drive');
  if (!tokens) {
    logger.warn({ ...logCtx }, 'voice-batch-merge: no Drive tokens — voice.md and client-facts.md not updated');
    return;
  }

  const drive = new DriveApiClient(
    googleClientId, googleClientSecret, tokens,
    (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
  );

  try {
    await updateVoiceMdOnDrive(db, drive, clientId, driveFolderId, channelTitle, newChannelBlock, logger);
    logger.info({ ...logCtx }, 'voice-batch-merge: voice.md updated in Drive');
  } catch (driveErr) {
    logger.error(
      { ...logCtx, err: String(driveErr) },
      'voice-batch-merge: voice.md Drive update failed — snapshot committed, Drive file may be stale',
    );
  }

  if (factualDeltas.length > 0) {
    try {
      await routeFactualDeltasToDrive(
        drive, clientFolderDriveId, channelTitle, factualDeltas, months, logger, logCtx,
      );
    } catch (factsErr) {
      logger.warn(
        { ...logCtx, err: String(factsErr) },
        'voice-batch-merge: client-facts.md update failed — non-fatal',
      );
    }
  }
}
