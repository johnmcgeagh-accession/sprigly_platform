import 'server-only';
import { z } from 'zod';
import { getChannelDrive, upsertDriveFile } from './drive';

/**
 * ingestIgPosts — the shared client-IG fallback core. Validates the uploaded array
 * against the igPostSchema contract (mirror of engine/src/lean-line.ts — the file
 * planning's loadHistoricPosts reads) and writes instagram-posts-<month>.json to the
 * channel Drive folder. Drive-first: planning picks it up unchanged, no re-run.
 *
 * NOTE: this schema mirrors the worker's canonical igPostSchema. Kept local because
 * @sprigly/engine has no zod dependency; consolidate when the ingest core is promoted
 * to its own package.
 */
const igPostSchema = z.object({
  timestamp:     z.string().min(1),
  caption:       z.string().optional(),
  likesCount:    z.number().int().nonnegative(),
  commentsCount: z.number().int().nonnegative(),
});
const igPostsArraySchema = z.array(igPostSchema);

export interface IngestIgResult { ok: boolean; message: string; count?: number }

export async function ingestIgPosts(clientId: string, channel: string, month: string, json: unknown): Promise<IngestIgResult> {
  const parsed = igPostsArraySchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length ? `at index ${first.path.join('.')}` : '';
    return { ok: false, message: `Invalid IG posts JSON ${where}: ${first?.message ?? parsed.error.message}. Expected an array of { timestamp (string), caption? (string), likesCount (integer ≥ 0), commentsCount (integer ≥ 0) }.` };
  }
  if (parsed.data.length === 0) return { ok: false, message: 'The JSON array is empty — nothing to upload.' };

  const d = await getChannelDrive(clientId, channel);
  if ('error' in d) return { ok: false, message: d.error };

  const content = Buffer.from(JSON.stringify(parsed.data, null, 2));
  const res = await upsertDriveFile(d.drive, d.driveFolderId, `instagram-posts-${month}.json`, 'application/json', content);
  return { ok: true, count: parsed.data.length, message: `IG posts uploaded (${parsed.data.length} posts, ${res}). Planning will read them for data month ${month}.` };
}
