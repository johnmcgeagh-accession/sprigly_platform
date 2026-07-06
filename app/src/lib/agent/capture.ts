/**
 * agent/capture.ts — turn a router "capture" result into a proposal (pure).
 *
 * The payload carries everything apply needs so approval is a deterministic
 * INSERT with no re-derivation. Cycle resolution (month → cycleId) is done by the
 * caller and passed in.
 */
import { CAPTURE_TO_INPUT, type CaptureIntent, type ProposalPayload, type RouterResult } from './types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(m?: string | null): string {
  if (!m) return '';
  const mm = /^(\d{4})-(\d{2})/.exec(m);
  return mm ? `${MONTH_NAMES[Number(mm[2]) - 1] ?? m} ${mm[1]}` : m;
}
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface CaptureProposal {
  intent: CaptureIntent;
  payload: ProposalPayload;
  summary: string;
}

/** Build the proposal (payload + one-line summary) for a capture intent. */
export function buildCapture(intent: CaptureIntent, result: RouterResult, resolvedCycleId: string | null): CaptureProposal {
  const payload: ProposalPayload = {
    type: CAPTURE_TO_INPUT[intent],
    content: result.content,
    cycleId: resolvedCycleId,
    targetMonth: result.targetMonth ?? null,
    channel: result.channel ?? null,
  };
  const monthPart = result.targetMonth ? ` for ${monthLabel(result.targetMonth)}` : '';
  const verb =
    intent === 'note_for_month' ? 'Save note' :
    intent === 'idea_backlog' ? 'Save idea' : 'Save for next cycle';
  return { intent, payload, summary: `${verb}${monthPart}: ${truncate(result.content, 80)}` };
}
