/**
 * /api/plan/draft — read and structurally edit a cycle's DRAFT beats. (Build B)
 *
 * GET  → the cycle's draft beats (the deliberate reader).
 * POST → one deterministic structural mutation: move | format | drop | add | reorder.
 *
 * No LLM, no queue: these are plain writes that return the new beat list, so the surface
 * refreshes from the same shape it renders. Approval is NOT here — nothing in this route
 * can change a row's status (Build D owns that).
 *
 * Every mutation re-derives clientId from the session and re-checks the draft + cutoff
 * guards server-side. The route never trusts a body field for identity or permission.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { loadDraftBeats, loadDraftSurfaceContext } from '@/lib/plan';
import {
  moveBeat, swapFormat, dropBeat, addBeat, restoreBeat, reorderWithinDay,
  type DraftMutationResult,
} from '@/lib/draft-mutations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A guard refusal is the client's fault, not the server's — map each to its own status so
 *  the surface can tell "gone" from "closed" from "not allowed". */
const STATUS: Record<string, number> = {
  not_found:      404,
  not_a_draft:    409,   // the row exists but has moved on — a conflict, not a 404
  cutoff_passed:  409,
  read_only_date: 422,
  invalid_format: 422,
  invalid_pillar: 422,
};

function respond(result: DraftMutationResult) {
  // `dropped` rides back on a drop so the client can hold the whole beat and hand it back
  // verbatim on undo — a re-add from {date,format,pillar} manufactured a husk instead.
  if (result.ok) return NextResponse.json({ ok: true, beats: result.beats, ...(result.dropped ? { dropped: result.dropped } : {}) });
  return NextResponse.json(
    { ok: false, error: result.error, message: result.message },
    { status: STATUS[result.error] ?? 400 },
  );
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const cycleId = new URL(req.url).searchParams.get('cycleId') ?? session.cycleId;
  const beats = await loadDraftBeats(session.clientId, cycleId);

  // Everything else the draft surface needs, so a client entering draft mode on a month
  // switch can render it WITHOUT the committed payload ever carrying draft data. This
  // route is the one deliberate draft reader; routing the context through it keeps that
  // true. Channel comes from the cycle row — never from the request.
  const [cyc] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  if (!cyc) return NextResponse.json({ beats, pillars: [], editable: false, receipts: [] });

  const ctx = await loadDraftSurfaceContext(session.clientId, cycleId, cyc.channel);
  return NextResponse.json({ beats, ...ctx });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* handled below */ }

  const op     = String(body['op'] ?? '');
  // cycleId is only ever taken from the session for ops that create rows — a caller must
  // not be able to plant a beat in a cycle they were not issued a link for (see runOp).
  try {
    return await runOp(op, body, session);
  } catch (err) {
    // An UNEXPECTED failure — a constraint, a trigger, a dropped connection. Every guard
    // refusal above returns a typed result and never lands here, so anything reaching this
    // point is ours, not the client's.
    //
    // It used to fall through as an unhandled rejection: Next returned a bare 500 and the
    // surface showed its generic connection error, which is what made the plan_activity FK
    // conflict look like a network problem for a day
    // (docs/reports/ivy-t-draft-mutation-500.md). A 500 is still correct — the fault IS the
    // server's — but it now says so in a shape the client can render, and the real error is
    // logged rather than swallowed.
    console.error('[plan/draft] mutation failed', { op, err });
    return NextResponse.json(
      { ok: false, error: 'mutation_failed', message: 'Something went wrong on our side. Nothing was changed.' },
      { status: 500 },
    );
  }
}

/** The op dispatch itself. Split out so every branch sits inside the POST handler's catch. */
async function runOp(op: string, body: Record<string, unknown>, session: { clientId: string; cycleId: string }) {
  const postId = typeof body['postId'] === 'string' ? body['postId'] : '';
  const cycleId = session.cycleId;

  switch (op) {
    case 'move': {
      const date = String(body['date'] ?? '');
      if (!postId || !date) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await moveBeat(session.clientId, postId, date));
    }
    case 'format': {
      const format = String(body['format'] ?? '');
      if (!postId || !format) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await swapFormat(session.clientId, postId, format));
    }
    case 'drop': {
      if (!postId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await dropBeat(session.clientId, postId));
    }
    case 'restore': {
      // The undo payload is the dropped beat's id and nothing else. It used to carry the whole
      // beat — date, format, pillar, title, position, evidence — because the drop hard-deleted
      // the row and the client's copy was the only one left. The drop is a tombstone now, so
      // the server re-reads the beat it already has; see DroppedBeat.
      const b = body['beat'];
      const id = b && typeof b === 'object'
        ? String((b as Record<string, unknown>)['id'] ?? '')
        : String(body['postId'] ?? '');
      if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await restoreBeat(session.clientId, cycleId, { id }));
    }
    case 'add': {
      const date   = String(body['date'] ?? '');
      const format = String(body['format'] ?? '');
      const pillar = String(body['pillar'] ?? '');
      // The subject is what the client said the post is about (round 6, P1). Optional — an
      // absent one leaves the beat named after its pillar, exactly as before.
      const subject = typeof body['subject'] === 'string' ? body['subject'] : undefined;
      if (!date || !format || !pillar) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await addBeat(session.clientId, cycleId, { date, format, pillar, ...(subject ? { subject } : {}) }));
    }
    case 'reorder': {
      const date = String(body['date'] ?? '');
      const ids  = Array.isArray(body['postIds']) ? body['postIds'].filter((v): v is string => typeof v === 'string') : [];
      if (!date || ids.length === 0) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return respond(await reorderWithinDay(session.clientId, cycleId, date, ids));
    }
    default:
      return NextResponse.json({ error: 'unknown_op' }, { status: 400 });
  }
}
