import 'server-only';
import { getChannelDrive, upsertDriveFile } from './drive';

/**
 * ingestIgPosts — the shared client-IG fallback core. Validates the uploaded array
 * against the igPostSchema contract (mirror of engine/src/lean-line.ts — the file
 * planning's loadHistoricPosts reads) and writes instagram-posts-<month>.json to the
 * channel Drive folder. Drive-first: planning picks it up unchanged, no re-run.
 *
 * Validation is hand-rolled (no zod) so this file needs no extra admin dependency;
 * it enforces the same contract as the worker's canonical igPostSchema: timestamp
 * required non-empty string, caption optional string, likes/comments non-negative
 * integers (floats and negatives rejected). Consolidate onto a shared schema when
 * this ingest core is promoted to its own package.
 */
interface IgPost { timestamp: string; caption?: string; likesCount: number; commentsCount: number }

function validateIgPosts(json: unknown): { ok: true; posts: IgPost[] } | { ok: false; message: string } {
  if (!Array.isArray(json)) return { ok: false, message: 'Expected a JSON array of posts.' };
  const posts: IgPost[] = [];
  for (let i = 0; i < json.length; i++) {
    const p = json[i] as Record<string, unknown>;
    if (typeof p !== 'object' || p === null) return { ok: false, message: `Item ${i} is not an object.` };
    if (typeof p.timestamp !== 'string' || p.timestamp.trim() === '') return { ok: false, message: `Item ${i}: "timestamp" must be a non-empty string.` };
    if (p.caption !== undefined && typeof p.caption !== 'string')       return { ok: false, message: `Item ${i}: "caption" must be a string if present.` };
    if (!Number.isInteger(p.likesCount)    || (p.likesCount as number)    < 0) return { ok: false, message: `Item ${i}: "likesCount" must be an integer ≥ 0.` };
    if (!Number.isInteger(p.commentsCount) || (p.commentsCount as number) < 0) return { ok: false, message: `Item ${i}: "commentsCount" must be an integer ≥ 0.` };
    posts.push({
      timestamp: p.timestamp,
      ...(typeof p.caption === 'string' ? { caption: p.caption } : {}),
      likesCount: p.likesCount as number,
      commentsCount: p.commentsCount as number,
    });
  }
  return { ok: true, posts };
}

export interface IngestIgResult { ok: boolean; message: string; count?: number }

export async function ingestIgPosts(clientId: string, channel: string, month: string, json: unknown): Promise<IngestIgResult> {
  const v = validateIgPosts(json);
  if (!v.ok) {
    return { ok: false, message: `${v.message} Expected an array of { timestamp (string), caption? (string), likesCount (integer ≥ 0), commentsCount (integer ≥ 0) }.` };
  }
  if (v.posts.length === 0) return { ok: false, message: 'The JSON array is empty — nothing to upload.' };

  const d = await getChannelDrive(clientId, channel);
  if ('error' in d) return { ok: false, message: d.error };

  const content = Buffer.from(JSON.stringify(v.posts, null, 2));
  const res = await upsertDriveFile(d.drive, d.driveFolderId, `instagram-posts-${month}.json`, 'application/json', content);
  return { ok: true, count: v.posts.length, message: `IG posts uploaded (${v.posts.length} posts, ${res}). Planning will read them for data month ${month}.` };
}
