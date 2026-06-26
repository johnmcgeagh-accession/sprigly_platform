/**
 * voice-consumer.ts — voice profile utilities and rollback operator.
 *
 * Pure helpers and shared logic for the voice ingestion pipeline.
 * The LLM merge is done by voice-batch-merge.ts (daily batched Sonnet call).
 *
 * Exported for testing:
 *   MERGE_PROMPT_VARS_KEYS — keys that MUST be present in the fillTemplate call.
 *   MERGE_PROMPT_SEED      — seed prompt text (must match 0033_voice_ingest_merge_prompt_v2.sql).
 *   fillTemplate           — `{{var}}` replacer (exported so the coverage test can use it).
 *   replaceChannelBlock    — voice.md section replacer (exported for unit test).
 *   formatEditSummary      — edit list formatter (exported for unit test).
 *   rollbackVoice          — operator rollback function.
 *   updateVoiceMdOnDrive   — writes voice.md to Drive (used by batch merge + rollback).
 */

import { eq, and, desc } from 'drizzle-orm';
import {
  db as _db,
  voiceIngestionRuns,
  voiceSnapshots,
  clientChannels,
  processedExternalIds,
} from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { Logger } from 'pino';
import type { VoiceEdit, VoiceSnapshot } from '@sprigly/db';

type Db = typeof _db;

// ── Prompt template ───────────────────────────────────────────────────────────
// These three keys MUST be present at every fillTemplate call site.
// The coverage test (voice-consumer.test.ts) extracts {{vars}} from MERGE_PROMPT_SEED
// and asserts every one appears in this array — preventing silent empty-string gaps.

export const MERGE_PROMPT_VARS_KEYS = [
  'channelTitle',
  'currentVoiceProfile',
  'editSummary',
] as const;

// Must stay in sync with migration 0036_voice_delta_prompt_v5.sql.
export const MERGE_PROMPT_SEED = `You extract voice and factual signals from client edits to a social media content agency's published drafts.

Channel: {{channelTitle}}

EXISTING VOICE PROFILE (context only — do not rewrite):
{{currentVoiceProfile}}

CLIENT EDITS THIS MONTH:
{{editSummary}}

Return ONLY a JSON array. No prose, no markdown fences, no preamble.
Do not include any text before the opening [ or after the closing ].

Each element:
{ "rule": "<imperative rule>",
  "evidence": { "before": "<≤15 words from draft>", "after": "<≤15 words from client version>" },
  "type": "voice" | "factual",
  "action": "add" | "update" | "remove",
  "targetSection": "<exact section heading — required for update/remove, omit for add>",
  "targetQuote": "<≤10 verbatim words from the line it amends — required for update/remove, omit for add>" }

- "voice": stylistic, structural, or vocabulary signal — how to write
- "factual": specific fact, number, product name, or claim that was corrected
- "add": new signal genuinely absent from the entire profile
- "update": refines, contradicts, or overlaps anything already in the EXISTING VOICE PROFILE
- "remove": contradicts an existing guideline so strongly it should be dropped

Action contract (critical):
- If a rule refines, contradicts, or overlaps ANYTHING already in the EXISTING VOICE PROFILE,
  you MUST use "update" or "remove" — NOT "add"
- Use "add" ONLY for genuinely new signal absent from the entire profile
- When unsure between "add" and "update", prefer "update" and cite the section
- For every "update" or "remove" delta you MUST include:
    "targetSection": the exact heading of the section it amends (e.g. "Vocabulary", "CTA style",
                     "Signature phrases", "Sentence & structure")
    "targetQuote":   a verbatim snippet of ≤10 words from the bullet or phrase it touches
                     — use readable prose text, not decorative formatting characters
                       such as spaced letters (S u n d a y) or emoji-only markers

Evidence rules:
- "before" and "after" must each be AT MOST ~15 words / 100 characters
- Quote only the key phrase that shows the difference; use "..." to mark omitted context
  e.g. before: "Unlock your wardrobe...potential", after: "Unlock your wardrobe's full potential"
- Never include a full caption — just enough to identify what changed

Consolidation (critical):
- This output is a list of RULES, not a per-edit transcript
- Multiple edits showing the same pattern MUST collapse into ONE delta — pick the
  clearest example for the evidence fields
- Expected output for a month's edits: roughly 5–12 deltas total, regardless of edit count
- Only include clear signals. 3+ edits showing the same pattern = strong signal.
  A single ambiguous edit = noise — omit it.
- If no clear signals found, return: []

Output only the JSON array starting with [ and ending with ].`;

// ── Pure helpers (exported for testing) ──────────────────────────────────────

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export function formatEditSummary(edits: Array<Pick<VoiceEdit,
  'postTitle' | 'date' | 'spriglyDraft' | 'contactAmended' | 'notes' | 'postIndex'
>>): string {
  return edits.map((edit) => {
    const label = [
      `Edit ${edit.postIndex ?? '?'}`,
      edit.postTitle && `: ${edit.postTitle}`,
      edit.date && ` (${edit.date})`,
    ].filter(Boolean).join('');

    const lines: string[] = [label];
    if (edit.spriglyDraft)   lines.push(`  Sprigly draft:     ${edit.spriglyDraft}`);
    if (edit.contactAmended) lines.push(`  Client amended to: ${edit.contactAmended}`);
    if (edit.notes)          lines.push(`  Client notes:      ${edit.notes}`);
    return lines.join('\n');
  }).join('\n\n');
}

/** Replace or append a channel block in voice.md.
 *  Blocks are level-2 headings: "## {ChannelTitle} — Voice Profile".
 *  Splits on `\n## ` so other channels are preserved exactly. */
export function replaceChannelBlock(
  voiceMd: string,
  channelTitle: string,
  newBlock: string,
): string {
  const heading = `## ${channelTitle} — Voice Profile`;

  // Split preserving the delimiter so other sections keep their leading `\n## `.
  // The first section won't start with \n## (it's the very beginning of the file).
  const sections = voiceMd.split(/(?=\n## )/);

  let found = false;
  const updated = sections.map((section) => {
    // Each section after the first starts with \n## ; trim for comparison.
    const trimmed = section.trimStart();
    if (trimmed.startsWith(heading)) {
      found = true;
      const prefix = section.startsWith('\n') ? '\n' : '';
      return `${prefix}${newBlock.trimEnd()}`;
    }
    return section;
  });

  if (!found) {
    updated.push(`\n\n${newBlock.trimEnd()}`);
  }

  return updated.join('').trim() + '\n';
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateMergedBlock(text: string, channelTitle: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Model returned empty voice block');
  const expectedHeading = `## ${channelTitle} — Voice Profile`;
  if (!trimmed.startsWith(expectedHeading)) {
    throw new Error(
      `Model output does not start with expected heading "${expectedHeading}". ` +
      `Got: "${trimmed.slice(0, 80)}"`,
    );
  }
  if (trimmed.length < 50) {
    throw new Error(`Model output too short (${trimmed.length} chars) — likely malformed`);
  }
}

// ── Self-write ledger ─────────────────────────────────────────────────────────

async function recordSelfWrite(db: Db, clientId: string, fileId: string, modifiedTime: string): Promise<void> {
  await db.insert(processedExternalIds).values({
    clientId,
    source:      'drive-self-write',
    externalId:  `${fileId}:${modifiedTime}`,
    processedAt: new Date(),
  }).onConflictDoNothing();
}

// ── voice.md Drive management ─────────────────────────────────────────────────

export async function updateVoiceMdOnDrive(
  db: Db,
  drive: DriveApiClient,
  clientId: string,
  driveFolderId: string,
  channelTitle: string,
  newBlock: string,
  logger: Logger,
): Promise<void> {
  const folderFiles = await drive.listFiles(driveFolderId);
  const existing    = folderFiles.find((f) => f.name === 'voice.md');

  let voiceMd = '';
  let voiceMdFileId: string;

  if (existing) {
    const buf = await drive.downloadFile(existing.id);
    voiceMd      = buf.toString('utf-8');
    voiceMdFileId = existing.id;
  }

  const updatedMd = replaceChannelBlock(voiceMd, channelTitle, newBlock);
  const content   = Buffer.from(updatedMd, 'utf-8');

  if (existing) {
    await drive.updateFile(existing.id, 'text/plain; charset=utf-8', content);
  } else {
    voiceMdFileId = await drive.createFile(driveFolderId, 'voice.md', 'text/plain; charset=utf-8', content);
  }

  // Fetch updated modifiedTime and record in self-write ledger.
  // voice.md is a .md file — WORKBOOK_RE never matches it — but we ledger it
  // as belt-and-suspenders against any future poller changes.
  try {
    const meta = await drive.getFileMeta(voiceMdFileId!);
    await recordSelfWrite(db, clientId, voiceMdFileId!, meta.modifiedTime);
  } catch (err) {
    logger.warn({ err: String(err) }, 'voice-ingest: could not record voice.md self-write ledger entry — non-fatal');
  }
}

// ── Rollback ──────────────────────────────────────────────────────────────────

/**
 * Explicit operator rollback. In ONE transaction:
 *   - Flip the current snapshot to is_current=false
 *   - Flip the target snapshot (default: most recent non-current) to is_current=true
 *   - Mark the rolled-back run as 'rolled_back'
 * Then regenerate voice.md from the restored snapshot.
 * History is never deleted.
 */
export async function rollbackVoice(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  clientId: string,
  channel: string,
  logger: Logger,
  toSnapshotId?: string,
): Promise<void> {
  // Find current snapshot
  const currentRows = await db
    .select()
    .from(voiceSnapshots)
    .where(and(
      eq(voiceSnapshots.clientId, clientId),
      eq(voiceSnapshots.channel, channel),
      eq(voiceSnapshots.isCurrent, true),
    ))
    .limit(1);

  const current = currentRows[0];
  if (!current) throw new Error(`rollbackVoice: no current snapshot for ${clientId}/${channel}`);

  // Find target snapshot
  let target: VoiceSnapshot;
  if (toSnapshotId) {
    const rows = await db
      .select()
      .from(voiceSnapshots)
      .where(and(
        eq(voiceSnapshots.clientId, clientId),
        eq(voiceSnapshots.channel, channel),
        eq(voiceSnapshots.id, toSnapshotId),
      ))
      .limit(1);
    if (!rows[0]) throw new Error(`rollbackVoice: snapshot ${toSnapshotId} not found`);
    target = rows[0];
  } else {
    // Most recent non-current snapshot
    const rows = await db
      .select()
      .from(voiceSnapshots)
      .where(and(
        eq(voiceSnapshots.clientId, clientId),
        eq(voiceSnapshots.channel, channel),
        eq(voiceSnapshots.isCurrent, false),
      ))
      .orderBy(desc(voiceSnapshots.createdAt))
      .limit(1);
    if (!rows[0]) throw new Error(`rollbackVoice: no previous snapshot to roll back to for ${clientId}/${channel}`);
    target = rows[0];
  }

  if (target.id === current.id) throw new Error('rollbackVoice: target and current are the same snapshot');

  // Atomic flip
  await db.transaction(async (tx) => {
    await tx
      .update(voiceSnapshots)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(eq(voiceSnapshots.id, current.id));

    await tx
      .update(voiceSnapshots)
      .set({ isCurrent: true, updatedAt: new Date() })
      .where(eq(voiceSnapshots.id, target.id));

    // Mark the run that produced the now-reverted snapshot as 'rolled_back'
    if (current.runId) {
      await tx
        .update(voiceIngestionRuns)
        .set({ status: 'rolled_back', updatedAt: new Date() })
        .where(eq(voiceIngestionRuns.id, current.runId));
    }
  });

  logger.info({ clientId, channel, fromSnapshotId: current.id, toSnapshotId: target.id }, 'voice-ingest: rollback committed');

  // Regenerate voice.md from the restored snapshot
  const channelTitle = channel.charAt(0).toUpperCase() + channel.slice(1);
  const tokens = await getTokens(db, encProvider, clientId, 'drive');
  if (!tokens) {
    logger.warn({ clientId, channel }, 'rollbackVoice: no Drive tokens — voice.md not regenerated');
    return;
  }

  const drive = new DriveApiClient(
    googleClientId, googleClientSecret, tokens,
    (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
  );

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
    logger.warn({ clientId, channel }, 'rollbackVoice: no drive_folder_id — voice.md not regenerated');
    return;
  }

  await updateVoiceMdOnDrive(db, drive, clientId, driveFolderId, channelTitle, target.snapshotMd, logger);
  logger.info({ clientId, channel, restoredSnapshotId: target.id }, 'rollbackVoice: voice.md regenerated from restored snapshot');
}
