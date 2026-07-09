/**
 * e2e-fake.ts — deterministic, env-gated fakes for the Playwright harness (Stage 3).
 *
 * HARD GATE: every fake here only activates when SPRIGLY_E2E_FAKE=1 AND
 * NODE_ENV !== 'production'. Both conditions must hold, so this can never run in a
 * real production deploy even if the env var leaks. Recorded in design/DECISIONS.md.
 *
 * The fakes sit at service boundaries, NOT the HTTP routes — the agent route, task
 * parser, proposal persistence, approve path, and shape route all stay real; only
 * the Bedrock model call and the Redis/BullMQ shape job are replaced.
 */
import type { ModelClient } from '@sprigly/model-client';

/** True only in a non-production e2e run with the flag set. */
export function e2eFakeEnabled(): boolean {
  return process.env['SPRIGLY_E2E_FAKE'] === '1' && process.env['NODE_ENV'] !== 'production';
}

/** Frozen "today" (ISO) for deterministic derivations, non-prod only. */
export function e2eTodayIso(): string | null {
  const v = process.env['PLAN_TODAY'];
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && process.env['NODE_ENV'] !== 'production') return v;
  return null;
}

/** Frozen "today" as a Date (noon UTC to avoid tz edges), or null. */
export function e2eTodayDate(): Date | null {
  const iso = e2eTodayIso();
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A canned ModelClient that never calls Bedrock. The task-parser call (recognised by
 * its system prompt) returns a tasks JSON derived from the instruction text; any
 * other call (e.g. the query answerer) returns a short canned string. Determinism:
 * "move …" picks the first post id from the week digest already in the prompt; "note …"
 * captures a note; anything else clarifies.
 */
export function makeFakeModelClient(): ModelClient {
  const complete = async (req: { system?: string; messages: { role: string; content: string }[] }) => {
    const system = req.system ?? '';
    const user = req.messages.map((m) => m.content).join('\n');
    const content = system.includes('ordered list of TASKS')
      ? JSON.stringify({ tasks: fakeTasks(user) })
      : 'This is a canned answer for testing.';
    return { content, inputTokens: 0, outputTokens: 0, modelId: 'fake-e2e', stopReason: 'end_turn' as const };
  };
  return { complete, completeStreaming: complete } as unknown as ModelClient;
}

function fakeTasks(userMessage: string): Record<string, unknown>[] {
  const clientMsg = between(userMessage, '"""');
  const lower = clientMsg.toLowerCase();
  if (lower.includes('note') || lower.includes('remember')) {
    return [{ action: 'add_note', content: clientMsg.trim() || 'A note from the client.', reason: 'note that down' }];
  }
  const postId = UUID_RE.exec(userMessage)?.[0];
  if (postId) {
    // A compound "move … and make it a carousel" decomposes into TWO independently-
    // approvable tasks on the SAME post (John's example). Pinned to the seeded reel
    // post (id …0003) so reel→carousel always differs — a no-op format change would be
    // guarded out and make the two-proposal e2e flaky.
    if (/carousel|make it a|change.*format|turn it into|single image/.test(lower)) {
      const REEL = '33333333-3333-4333-8333-000000000003';
      return [
        { action: 'move_post', postId: REEL, toDate: '2026-07-24', reason: 'move it later' },
        { action: 'change_format', postId: REEL, format: 'carousel', reason: 'make it a carousel' },
      ];
    }
    return [{ action: 'move_post', postId, toDate: '2026-07-24', reason: 'move it later' }];
  }
  return [{ action: 'clarify', question: 'Which post did you mean?', reason: 'unclear' }];
}

function between(s: string, delim: string): string {
  const a = s.indexOf(delim);
  if (a === -1) return '';
  const b = s.indexOf(delim, a + delim.length);
  return b === -1 ? '' : s.slice(a + delim.length, b);
}

/** The caption a faked shape job writes, so "shape pending → caption swaps" is
 *  deterministic without Redis/Bedrock. */
export const E2E_SHAPED_CAPTION =
  'We’ve been quietly working on this one and it’s finally ready to share. Come and see it — link in bio.';

/** The 3 hook candidates a faked hook job returns — deterministic for e2e. */
export const E2E_HOOK_CANDIDATES = [
  'The real reason this top sold out twice — and it isn’t the fabric.',
  'Stop washing linen like cotton. Do this instead.',
  'POV: you’re the friend whose outfit everyone quietly asks about.',
];

/**
 * A deterministic 15-day forecast (today + 14) for the weather overlay e2e, anchored
 * to the frozen PLAN_TODAY. Codes span the icon buckets (sun / partly / overcast / rain
 * / heavy-rain / thunder / snow / fog) so multiple distinct icons render in-window;
 * days outside this window get no entry, so they render nothing.
 */
const E2E_WEATHER_CODES = [0, 2, 3, 61, 65, 95, 71, 45, 0, 2, 3, 80, 2, 0, 3];
const E2E_WEATHER_TEMPS = [24, 22, 19, 17, 16, 20, 3, 15, 25, 23, 18, 17, 21, 26, 19];
const DAY_MS = 24 * 60 * 60 * 1000;

export function e2eWeatherForecast(baseIso: string): { date: string; weather_code: number; temp_max_c: number }[] {
  const [y, m, d] = baseIso.split('-').map(Number);
  const base = Date.UTC(y!, m! - 1, d!, 12);
  return E2E_WEATHER_CODES.map((code, i) => ({
    date: new Date(base + i * DAY_MS).toISOString().slice(0, 10),
    weather_code: code,
    temp_max_c: E2E_WEATHER_TEMPS[i]!,
  }));
}

/** The structured script a faked script job writes (reel), deterministic for e2e. */
export const E2E_SCRIPT_TEXT =
  'HOOK: The real reason this top sold out twice — and it isn’t the fabric.\n\n' +
  'BEAT 1 (0–5s) — Close-up on the weave, hands turning the fabric to the light.\n' +
  'BEAT 2 (5–20s) — Cut to the studio: why we chose this cloth, one honest sentence.\n' +
  'BEAT 3 (20–27s) — The top on a real body, moving.\n\n' +
  'CTA: Back in stock this week — link in bio.';
