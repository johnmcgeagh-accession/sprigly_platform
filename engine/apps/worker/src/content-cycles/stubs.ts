/**
 * stubs.ts — typed stubs for content_cycles STUB workers.
 *
 * Each stub has the correct signature so it can be called at the right
 * transition point. Replacing a stub is drop-in: no machine changes needed.
 * All stubs throw NOT_IMPLEMENTED. Callers that must be non-blocking (e.g.
 * the coherence detector in extract.ts) wrap in try-catch and continue.
 */

import type { RuleDelta } from '../voice-batch-merge.js';

export async function requestEmailStub(
  clientId:   string,
  channel:    string,
  cycleMonth: string,
): Promise<void> {
  // Lazy imports keep stubs.ts importable without triggering env validation,
  // since other stubs (coherenceDetectorStub) are imported by extract.ts in tests.
  const [
    { db },
    { createEncryptionProvider, getTokens, storeTokens },
    { DriveApiClient, createGmailDraftService },
    { createModelClientFromEnv },
    { default: pino },
    { env },
    { runRequestEmail },
  ] = await Promise.all([
    import('@sprigly/db'),
    import('@sprigly/oauth-tokens'),
    import('@sprigly/sources'),
    import('@sprigly/model-client'),
    import('pino'),
    import('../env.js'),
    import('./request-email.js'),
  ]);

  const encProvider = createEncryptionProvider();
  const tokens = await getTokens(db, encProvider, clientId, 'drive');
  if (!tokens) throw new Error(`request-email: no Drive tokens for client ${clientId}`);

  const logger = pino({ name: 'request-email' });
  const drive = new DriveApiClient(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    tokens,
    async (t) => {
      try {
        await storeTokens(db, encProvider, clientId, 'drive', t);
      } catch (err) {
        logger.warn({ clientId, err }, 'request-email: Drive token refresh write-back failed — will self-heal on next call');
      }
    },
  );
  const gmailDraftService = createGmailDraftService(
    db, encProvider, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, logger,
  );
  const model = createModelClientFromEnv();

  await runRequestEmail(clientId, channel, cycleMonth, {
    db, drive, gmailDraftService, model, logger,
  });
}

// TODO: implement reply-capture and parsing (reply arrives → reply_received)
export async function replyCaptureStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
): Promise<{ intakeSource: 'reply'; intakeJson: Record<string, unknown> }> {
  throw new Error('NOT_IMPLEMENTED: reply-capture+parse worker');
}

// TODO: implement no-reply fallback (deadline passes with no reply → intake_confirmed)
export async function noReplyFallbackStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
): Promise<{ intakeJson: Record<string, unknown> }> {
  throw new Error('NOT_IMPLEMENTED: no-reply-fallback');
}

// TODO: implement intake confirmation email (reply_received → awaiting_confirmation)
export async function intakeConfirmationEmailStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
  _intakeJson: Record<string, unknown>,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: intake-confirmation-email worker');
}

// TODO: implement planning worker (intake_confirmed → planning): lean-line + draft CSV
export async function planningWorkerStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
  _intakeJson: Record<string, unknown>,
): Promise<{ leanLine: string; draftCsvRef: string }> {
  throw new Error('NOT_IMPLEMENTED: planning worker');
}

// TODO: implement workbook delivery worker (workbook_built → delivered): share + email
export async function deliveryWorkerStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
  _workbookRef: string,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: delivery-email worker');
}

// TODO: implement finalisation-cutoff trigger (active → finalised)
export async function finalisationCutoffStub(
  _clientId:   string,
  _channel:    string,
  _cycleMonth: string,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: finalisation-cutoff trigger');
}

// TODO: implement coherence detector.
// Non-blocking: extract.ts wraps this in try-catch and continues on NOT_IMPLEMENTED.
// NEVER modifies voice.md or the snapshot — read-only analysis only.
export async function coherenceDetectorStub(
  _canonicalProfile: string,
  _voiceDeltas:      RuleDelta[],
  _clientId:         string,
  _channel:          string,
): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: coherence-detector');
}
