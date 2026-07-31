import 'server-only';
import { db, igPosts } from '@sprigly/db';

/**
 * ingestIgPosts — the shared client-IG fallback core. Validates the uploaded array
 * against the igPostSchema contract (mirror of engine/src/lean-line.ts — what
 * planning's loadHistoricPosts reads) and upserts it into the ig_posts DB table,
 * keyed (client_id, channel, month). Re-homed off Drive: planning + the lean line
 * read the row directly; no Drive file is written.
 *
 * Validation is hand-rolled (no zod) so this file needs no extra admin dependency;
 * it enforces the same contract as the worker's canonical igPostSchema: timestamp
 * required non-empty string, caption optional string, likes/comments non-negative
 * integers (floats and negatives rejected). Consolidate onto a shared schema when
 * this ingest core is promoted to its own package.
 */
interface IgPost { timestamp: string; caption?: string; likesCount: number; commentsCount: number; mediaType?: 'image' | 'reel' | 'carousel' }

// Media type, tolerant of both our own shape (mediaType: 'image'|'reel'|'carousel') and
// a raw Apify item (type: 'Image'|'Video'|'Sidecar'). Mirrors the worker's mapApifyMediaType
// (engine/src/lean-line.ts) — kept inline so this ingest core needs no worker dependency.
// Case-insensitive on the raw value for the same reason the worker's is: two copies of one
// rule diverging on casing is a silent loss, and the upload path is the one a human pastes
// hand-edited JSON into.
function resolveMediaType(p: Record<string, unknown>): 'image' | 'reel' | 'carousel' | undefined {
  const mt = p.mediaType;
  if (mt === 'image' || mt === 'reel' || mt === 'carousel') return mt;
  switch (typeof p.type === 'string' ? p.type.trim().toLowerCase() : '') {
    case 'video':   return 'reel';
    case 'sidecar': return 'carousel';
    case 'image':   return 'image';
    default:        return undefined;
  }
}

/** Posts that carry neither a usable mediaType nor a mappable raw `type`. Reported back to
 *  the operator rather than dropped quietly — an absent mediaType is indistinguishable
 *  downstream from a pre-mediaType row, so nobody would ever find out. */
function untypedCount(posts: IgPost[]): number {
  return posts.filter((p) => !p.mediaType).length;
}

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
    const mediaType = resolveMediaType(p);
    posts.push({
      timestamp: p.timestamp,
      ...(typeof p.caption === 'string' ? { caption: p.caption } : {}),
      likesCount: p.likesCount as number,
      commentsCount: p.commentsCount as number,
      ...(mediaType ? { mediaType } : {}),
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

  // Latest-wins upsert into ig_posts (re-homed off Drive) — replaces the month's row.
  const payload = v.posts as unknown as Array<Record<string, unknown>>;
  await db
    .insert(igPosts)
    .values({ clientId, channel, month, posts: payload })
    .onConflictDoUpdate({
      target: [igPosts.clientId, igPosts.channel, igPosts.month],
      set:    { posts: payload, updatedAt: new Date() },
    });
  const untyped = untypedCount(v.posts);
  const untypedNote = untyped > 0
    ? ` ${untyped} of them carry no recognised media type and will be invisible to format derivation.`
    : '';
  return { ok: true, count: v.posts.length, message: `IG posts saved (${v.posts.length} posts).${untypedNote} Planning will read them for data month ${month}.` };
}
