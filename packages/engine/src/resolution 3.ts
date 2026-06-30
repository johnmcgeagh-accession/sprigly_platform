import { db as _db, triageCaptureLog, incomingEvents } from '@sprigly/db';
import { eq } from 'drizzle-orm';

type Db = typeof _db;

export type ResolutionDecision = 'approved_as_is' | 'modified' | 'rejected';
export type CorrectionType = 'voice' | 'substance' | 'routing' | 'none';

export interface RecordResolutionParams {
  captureLogId: string;
  decision: ResolutionDecision;
  /** The human's final action, if changed from the suggestion. */
  finalAction?: string;
  /** The human's final text, if changed from the draft. */
  finalText?: string;
  decidedBy?: string;
  /** The suggestion's original action — used to infer correctionType. */
  originalAction?: string;
  /** The suggestion's original text — used to infer correctionType. */
  originalText?: string;
}

/**
 * Infers what type of correction was made:
 *   routing   — action or category changed, or decision was rejected
 *   substance — text significantly longer (>30% growth) suggesting new facts added
 *   voice     — text changed but similar length (style/tone edit)
 *   none      — approved without modification
 */
function inferCorrectionType(params: RecordResolutionParams): CorrectionType {
  if (params.decision === 'approved_as_is') return 'none';
  if (params.decision === 'rejected') return 'routing';

  // modified
  if (
    params.finalAction !== undefined &&
    params.originalAction !== undefined &&
    params.finalAction !== params.originalAction
  ) {
    return 'routing';
  }

  if (params.finalText !== undefined && params.originalText !== undefined) {
    const origLen = params.originalText.length;
    const finalLen = params.finalText.length;
    const growth = origLen > 0 ? (finalLen - origLen) / origLen : 0;
    if (growth > 0.3) return 'substance';
    return 'voice';
  }

  return 'routing';
}

/**
 * Records a human resolution against a triage suggestion and flips the
 * Gmail read-state for the underlying email.
 *
 * Wire `markRead` from `createGmailReadStateService` in the worker layer.
 * The function never throws on markRead failures — errors go to
 * gmail_operation_errors and are visible in the admin UI.
 */
export async function recordResolution(
  db: Db,
  markRead: (clientId: string, externalId: string) => Promise<void>,
  params: RecordResolutionParams,
): Promise<void> {
  const correctionType = inferCorrectionType(params);

  await db
    .update(triageCaptureLog)
    .set({
      decision: params.decision,
      correctionType,
      finalAction: params.finalAction ?? null,
      finalText: params.finalText ?? null,
      decidedBy: params.decidedBy ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(triageCaptureLog.id, params.captureLogId));

  // Look up the event to get the externalId needed for markRead.
  const logRows = await db
    .select({ clientId: triageCaptureLog.clientId, eventId: triageCaptureLog.eventId })
    .from(triageCaptureLog)
    .where(eq(triageCaptureLog.id, params.captureLogId))
    .limit(1);

  const logRow = logRows[0];
  if (logRow === undefined) return;

  const eventRows = await db
    .select({ externalId: incomingEvents.externalId })
    .from(incomingEvents)
    .where(eq(incomingEvents.id, logRow.eventId))
    .limit(1);

  const externalId = eventRows[0]?.externalId;
  if (externalId !== null && externalId !== undefined) {
    await markRead(logRow.clientId, externalId);
  }
}
