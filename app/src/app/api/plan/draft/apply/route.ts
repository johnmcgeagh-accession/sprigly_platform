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
import { ensureConversation, appendMessage } from '@/lib/agent/conversation';
import { threadMessage } from '@/lib/receipt-copy';
import { getCycleMonth, monthLabel } from '@/lib/agent/cycle-state';
import { resolveWriteCycle, requestedCycleId } from '@/lib/write-cycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  no_cycle:      404,
  no_draft:      409,
  cutoff_passed: 409,
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  // The receipts belong to the month ON SCREEN, not to the month the link names.
  const target = await resolveWriteCycle(session, new URL(req.url).searchParams.get('cycleId'));
  if (!target.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ receipts: await loadReceipts(target.cycleId) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* handled below */ }

  const op = String(body['op'] ?? 'text');

  /**
   * THE MONTH THE CLIENT IS LOOKING AT, not the one their link names.
   *
   * Resolved once, before any branch, so every write below — the reshape, the promotion, the
   * receipt and the conversation turn — lands on the same cycle. Splitting it per branch is
   * how the receipt came to be filed on a different month from the beats it described.
   */
  const target = await resolveWriteCycle(session, requestedCycleId(body));
  if (!target.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cycleId = target.cycleId;

  if (op === 'add_to_month') {
    const planInputId = String(body['planInputId'] ?? '');
    const date = String(body['date'] ?? '');
    if (!planInputId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }
    const res = await addBacklogItemToMonth({
      clientId: session.clientId, cycleId, planInputId, date, model: getModelClient(),
    });
    return res.ok
      ? NextResponse.json({ ok: true, application: res.application, beats: res.beats })
      : NextResponse.json({ ok: false, error: res.error, message: res.message }, { status: STATUS[res.error] ?? 400 });
  }

  if (op !== 'text') return NextResponse.json({ error: 'unknown_op' }, { status: 400 });

  const text = String(body['text'] ?? '').trim();
  if (!text) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // GAP 8. `POST /api/plan/agent` and `POST /api/plan/intake` have taken this since Build 3;
  // this route took `{op, text}` and nothing else, so spoken and typed input were
  // indistinguishable on the ledger. Anything that is not the literal 'voice' is 'web' — an
  // unknown value must not invent a third transport.
  const source = body['source'] === 'voice' ? 'voice' : 'web';

  // applyTextToDraft decides: a pasted DOCUMENT goes through the decomposer, a single
  // instruction takes the existing path, byte-identical. The route stays thin.
  const res = await applyTextToDraft({
    clientId: session.clientId, cycleId, text, source, model: getModelClient(),
  });

  // THE THREAD (conversation sheet). A draft reshape is a turn of the same per-cycle
  // conversation the committed agent writes, so the sheet's thread survives a reopen on a
  // draft month too. The assistant turn's content is the receipt's own lines — the applied
  // truth, not a paraphrase. Best-effort: a failed append must never fail a landed reshape.
  let conversationId: string | null = null;
  if (res.ok) {
    try {
      conversationId = await ensureConversation(session.clientId, cycleId);
      await appendMessage({ conversationId, role: 'user', content: text, source, writer: 'draft-apply', outcome: 'user' });
      // THE STORED TRANSCRIPT IS THE COPY THAT OUTLIVES THE SESSION, and it was the fifth
      // emitter of the same sentence — hardcoded here, branching on `scope` alone, written into
      // the conversation where it disagrees with the receipt permanently. It reads the same rule
      // as the thread now. The month is fetched for it: a family sentence names the month, and
      // "this month" in a transcript read back weeks later names nothing.
      const planMonth = await getCycleMonth(session.clientId, cycleId).catch(() => null);
      await appendMessage({
        conversationId, role: 'assistant',
        // Bare month name, no year — `DraftSurface` renders `monthTitle(month).split(' ')[0]`,
        // and "changing September 2026" in the transcript beside "changing September" in the
        // thread is the same drift this commit exists to remove, one word smaller.
        content: threadMessage(res.application, planMonth ? monthLabel(planMonth).split(' ')[0]! : 'this month'),
        // 'receipt', not 'answered' (0092): this row is the draft surface's applied-lines
        // receipt, not a plan-agent turn, and the two were previously the same shape.
        writer: 'draft-apply', outcome: 'receipt',
        metadata: { receiptId: res.application?.id ?? null, changedIds: res.application?.changedIds ?? [] },
      });
    } catch { conversationId = null; }
  }

  return res.ok
    ? NextResponse.json({ ok: true, application: res.application, beats: res.beats, conversationId })
    : NextResponse.json({ ok: false, error: res.error, message: res.message }, { status: STATUS[res.error] ?? 400 });
}
