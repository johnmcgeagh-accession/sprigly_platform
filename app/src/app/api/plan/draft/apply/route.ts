/**
 * POST /api/plan/draft/apply — one sentence in, a reshaped month and a receipt out.
 *
 * The north-star path. The route stays thin: it derives identity from the session, hands
 * the text to draft-apply.ts, and returns the receipt plus the refreshed beats so the
 * surface renders the authoritative result rather than predicting it.
 *
 * Two ops:
 *   text        — classify and apply (or file to the backlog)
 *   add_to_month — promote an existing backlog idea into this month
 *
 * Deliberately separate from /api/plan/draft (the structural mutations). Those are
 * deterministic edits the client made directly; this one involves a model and can route
 * an input somewhere the client did not explicitly ask for. Different contracts, different
 * failure modes, different routes.
 *
 * NOT the post-cutoff agent path. This route only ever touches status='draft' rows in a
 * pre-cutoff cycle; the extract-gate-apply agent flow is untouched by this build.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getModelClient } from '@/lib/agent/model';
import { applyTextToDraft, addBacklogItemToMonth, loadReceipts } from '@/lib/draft-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  no_cycle:      404,
  no_draft:      409,
  cutoff_passed: 409,
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  return NextResponse.json({ receipts: await loadReceipts(session.cycleId) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* handled below */ }

  const op = String(body['op'] ?? 'text');

  if (op === 'add_to_month') {
    const planInputId = String(body['planInputId'] ?? '');
    const date = String(body['date'] ?? '');
    if (!planInputId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const res = await addBacklogItemToMonth({
      clientId: session.clientId, cycleId: session.cycleId, planInputId, date, model: getModelClient(),
    });
    return res.ok
      ? NextResponse.json({ ok: true, application: res.application, beats: res.beats })
      : NextResponse.json({ ok: false, error: res.error, message: res.message }, { status: STATUS[res.error] ?? 400 });
  }

  if (op !== 'text') return NextResponse.json({ error: 'unknown_op' }, { status: 400 });

  const text = String(body['text'] ?? '').trim();
  if (!text) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // applyTextToDraft decides: a pasted DOCUMENT goes through the decomposer, a single
  // instruction takes the existing path, byte-identical. The route stays thin.
  const res = await applyTextToDraft({
    clientId: session.clientId, cycleId: session.cycleId, text, model: getModelClient(),
  });
  return res.ok
    ? NextResponse.json({ ok: true, application: res.application, beats: res.beats })
    : NextResponse.json({ ok: false, error: res.error, message: res.message }, { status: STATUS[res.error] ?? 400 });
}
