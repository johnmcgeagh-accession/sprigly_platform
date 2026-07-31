/**
 * POST /api/plan/preview — the LIVE preview pass for the planning workspace (Phase 1).
 *
 * A cheap Haiku read over the client's in-progress brief text. PURE PREVIEW: it never writes the
 * DB, never gates anything, and returns an empty preview on short input or any failure. The
 * authoritative brief is still the commit-time extraction (POST /api/plan/intake), unchanged.
 *
 * Cost guard: the CLIENT enforces "no call while one is in flight" + a ~20-call-per-session cap
 * (useLivePreview). This route is the server BACKSTOP: a per-client token bucket (burst 6, refill
 * 1/3s ≈ 20/min) via allowRequest, plus the min-length short-circuit that skips the model entirely.
 * Envelope: ≤ ~20 Haiku calls per planning session, each ~1k in / ≤1.2k out — a small fraction of
 * one Sonnet commit extraction.
 */
import { NextResponse } from 'next/server';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db, planInputs } from '@sprigly/db';
import { createAuditLogger } from '@sprigly/audit';
import { previewBrief, EMPTY_PREVIEW, PREVIEW_MIN_CHARS, type PreviewDurable } from '@sprigly/engine';
import { getSession } from '@/lib/auth';
import { allowRequest } from '@/lib/rate-limit';
import { getModelClient } from '@/lib/agent/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel(d: Date): string { return MON[d.getUTCMonth()] ?? ''; }

/** The client's active durables (idea | next_cycle), each with the month it was captured — for
 *  provenance tags + connection follow-ups in the preview. Never fails the request. */
async function loadDurables(clientId: string): Promise<PreviewDurable[]> {
  try {
    const rows = await db
      .select({ content: planInputs.content, createdAt: planInputs.createdAt })
      .from(planInputs)
      .where(and(
        eq(planInputs.clientId, clientId),
        eq(planInputs.status, 'active'),
        or(isNull(planInputs.relevantFrom), lte(planInputs.relevantFrom, '9999-12-31')),
        or(isNull(planInputs.relevantTo), gte(planInputs.relevantTo, '0000-01-01')),
      ))
      .limit(12);
    return rows
      .filter((r) => typeof r.content === 'string' && r.content.trim().length > 0)
      .map((r) => ({ content: r.content, month: monthLabel(new Date(r.createdAt)) }));
  } catch { return []; }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId } = session;

  // Server backstop for the cost guard (client also self-limits): a per-client token bucket.
  if (!allowRequest(`preview:${clientId}`, 6, 1 / 3)) {
    return NextResponse.json({ preview: EMPTY_PREVIEW, rateLimited: true }, { status: 200 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const text = typeof body.text === 'string' ? body.text : '';
  // Short-circuit below the threshold — no model call, no cost.
  if (text.trim().length < PREVIEW_MIN_CHARS) return NextResponse.json({ preview: EMPTY_PREVIEW });

  const durables = await loadDurables(clientId);
  // The route's own header promises "≤ ~20 Haiku calls per planning session" — an envelope that
  // was argued rather than measured, because none of those calls reached the ledger. They do now:
  // `previewBrief` has always logged behind `if (audit && clientId)`, and only the auditor was
  // missing. The two guards above (token bucket, min-length short-circuit) are unchanged; this
  // adds the row that lets the envelope be checked against what actually happened.
  const preview = await previewBrief({ text, durables, model: getModelClient(), clientId, audit: createAuditLogger(db) });
  return NextResponse.json({ preview });
}
