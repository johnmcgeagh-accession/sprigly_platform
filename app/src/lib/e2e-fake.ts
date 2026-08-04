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
/**
 * A message's text, whatever shape it arrives in.
 *
 * `content` used to be a string. Prompt caching (`0988a39`) split the parser's user message
 * into `MessagePart[]` — an invariant prefix, a `cache_point`, then the variable tail — and
 * this fake kept doing `.map(m => m.content).join('\n')`, which on an array of parts yields
 * `[object Object]`. Every e2e parse therefore saw an empty message and answered "Which post
 * did you mean?", and four conversation specs failed for a reason that had nothing to do with
 * them. Nothing caught it because the migration manifest was separately blocking the suite
 * from building its database at all.
 *
 * Reading BOTH shapes is the point: the fake must not have an opinion about how the real call
 * is packaged, or it goes stale the next time that changes.
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
    .join('\n');
}

export function makeFakeModelClient(): ModelClient {
  const complete = async (req: { system?: string; messages: { role: string; content: unknown }[] }) => {
    const system = req.system ?? '';
    const user = req.messages.map((m) => messageText(m.content)).join('\n');
    const content = isClassifyCall(system)
      ? JSON.stringify(fakeClassification(user))
      : system.includes('ordered list of TASKS')
      ? JSON.stringify({ tasks: fakeTasks(user) })
      : 'This is a canned answer for testing.';
    return { content, inputTokens: 0, outputTokens: 0, modelId: 'fake-e2e', stopReason: 'end_turn' as const };
  };
  return { complete, completeStreaming: complete } as unknown as ModelClient;
}

/**
 * The opening of the intake classifier's system prompt, which is how a classify call is told
 * apart from the task parser's.
 *
 * IT IS A COPY, AND THAT IS THE POINT OF THE TEST BESIDE IT. Importing `CLASSIFY_SYSTEM` from
 * `@sprigly/engine` would be the drift-proof version, but this module is loaded by `queue.ts`
 * and `model.ts` — the Next.js runtime — and the engine barrel drags `@sprigly/db`'s client in
 * with it, so a test-only guarantee would cost every request a database import. Instead
 * `e2e-fake.parity.test.ts` asserts this constant against the real prompt: change the prompt
 * and the unit test fails by name, rather than every draft e2e failing by timeout.
 */
export const E2E_CLASSIFY_MARKER = "You route a single message from a small brand's owner";

function isClassifyCall(system: string): boolean {
  return system.includes(E2E_CLASSIFY_MARKER);
}

/**
 * A deterministic routing decision for a draft reshape (`POST /api/plan/draft/apply`).
 *
 * ── What this must get right, and what it deliberately does not do ───────────────────
 *
 * It is NOT a classifier. It recognises the handful of instructions the draft e2e types and
 * returns the routing a correct classifier would return for each; anything else lands on
 * EVERGREEN, which is exactly what the real one does when it is unsure — so an unrecognised
 * sentence in a future test files itself to the backlog rather than silently applying a
 * fabricated change to a month.
 *
 * ── How it stays honest ──────────────────────────────────────────────────────────────
 *
 * The output is a `MonthScopedIntent`-shaped object and it is checked as one:
 * `e2e-fake.parity.test.ts` runs every branch below through the REAL `parseClassification`
 * → `routeFromParsed` pair — the same two functions the production path uses on a Bedrock
 * response — and asserts the routing that comes out. A field this fake stops emitting, or
 * emits under a stale name, fails there rather than in a Playwright timeout six months later.
 * That is the C4 lesson applied up front: the script job that wrote a script without its hook
 * was undetectable because nothing compared the fake's field-set to the real one's.
 */
export function fakeClassification(user: string): Record<string, unknown> {
  // The classifier is handed `OWNER'S MESSAGE:` followed by the text, verbatim.
  const sourceText = between(user, 'OWNER’S MESSAGE:\n', '\n\nRoute it now.').trim() || user.trim();
  const lower = sourceText.toLowerCase();
  // The plan month it was told to resolve relative dates against, e.g. '2026-09'.
  const planMonth = /PLAN MONTH: (\d{4}-\d{2})/.exec(user)?.[1] ?? '2026-09';

  const intent = (over: Record<string, unknown>) => ({
    scope: 'month_scoped',
    intent: {
      subject: '', sourceText,
      dateRange: null, format: null, postsPerWeek: null, postsPerMonth: null,
      instances: null, recurrence: null, beatRef: null, edit: null, editValue: null,
      emphasis: null, correctionOf: null,
      ...over,
    },
  });

  // A CORRECTION with a new date — "move the Weekend Style Guide to the 12th". The e2e's
  // reshape: one beat changes day, the receipt says which, the month is otherwise untouched.
  //
  // `correctionOf` is THE THING BEING CORRECTED, in the owner's words — not the whole
  // sentence. `applyCorrection` resolves it against the beats' own subjects, so handing it
  // the verb and the date as well guarantees no match and a "we couldn't find that on this
  // month's plan" every time. The real classifier is told this in as many words ("the thing
  // being corrected in the owner's words"); the fake has to obey the same instruction or it
  // tests the failure path while claiming to test the success one.
  const dateClause = /\bto\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/.exec(lower);
  if (/\b(move|actually|not the|instead of|push)\b/.test(lower) && dateClause) {
    const day = dateClause[1]!;
    const date = `${planMonth}-${day.padStart(2, '0')}`;
    const subject = sourceText
      .replace(/^\s*(please\s+)?(move|push|actually,?\s*move)\s+/i, '')
      .replace(/\s+to\s+(the\s+)?\d{1,2}(st|nd|rd|th)\b.*$/i, '')
      .replace(/^the\s+/i, '')
      .trim();
    return intent({ kind: 'correction', subject, correctionOf: subject, dateRange: { start: date, end: date } });
  }

  // A CADENCE target — a number of posts, no date, no title.
  const perWeek = /\b(\d+)\s+posts?\s+a\s+week\b/.exec(lower)?.[1];
  if (perWeek) {
    return intent({ kind: 'cadence', subject: `${perWeek} posts a week`, postsPerWeek: Number(perWeek) });
  }

  // An EMPHASIS shift for this month.
  if (/\bmore\b|\bless\b/.test(lower)) {
    return intent({ kind: 'emphasis', subject: sourceText, emphasis: sourceText });
  }

  // Unsure → evergreen, which is the real classifier's own rule and its safest failure.
  return { scope: 'evergreen' };
}

/** Seeded post ids (see seed-e2e.ts): …0003 is a reel (no hook/script), …0001 a single
 *  image, …0006 a reel seeded WITH a hook + script (for refine). */
const E2E_REEL = '33333333-3333-4333-8333-000000000003';
const E2E_SINGLE = '33333333-3333-4333-8333-000000000001';
const E2E_REEL_WITH_FIELDS = '33333333-3333-4333-8333-000000000006';

/** Best-effort topic extraction for a deterministic add_post instruction (about/of/showing …,
 *  minus any trailing "with … hook" clause). e2e asserts on the format, not this text. */
function fakeTopic(msg: string): string {
  const noHook = msg.replace(/\s+(with|and)\s+.*hook.*$/i, '').trim();
  const m = /(?:about|of|showing)\s+(.+)$/i.exec(noHook);
  return (m?.[1] ?? noHook).replace(/[.?!]+$/, '').trim();
}

function fakeTasks(userMessage: string): Record<string, unknown>[] {
  const clientMsg = between(userMessage, '"""');
  const lower = clientMsg.toLowerCase();
  if (lower.includes('note') || lower.includes('remember')) {
    return [{ action: 'add_note', content: clientMsg.trim() || 'A note from the client.', reason: 'note that down' }];
  }

  // REFINE an existing hook/script (§26 Part 2) — a refinement verb aimed at a hook/script.
  // "boxes" → the reel seeded WITH a hook + script (…0006); otherwise the reel WITHOUT one
  // (…0003), which the route turns into an offer-to-generate question.
  const refineVerb = /\b(refine|punchier|snappier|tighten|shorten|rework|reword|warmer)\b/.test(lower);
  if (refineVerb && /\b(hook|script)\b/.test(lower)) {
    const target = /\bscript\b/.test(lower) ? 'script' : 'hook';
    const postId = /\bboxes\b/.test(lower) ? E2E_REEL_WITH_FIELDS : E2E_REEL;
    return [{ action: 'refine', postId, target, instruction: clientMsg.trim(), reason: clientMsg.trim() }];
  }

  // Scripts (WRITE from scratch, no refine verb) → product-aware guidance, never a generic
  // question (§24 Part 1).
  if (lower.includes('script')) {
    return [{ action: 'clarify', question: 'Open the reel and use Generate script in the post editor (once it has a hook and caption).', reason: 'write the script' }];
  }

  const wantsHook = /\bhooks?\b/.test(lower);
  // "add/create a <reel|carousel|post|photo|…>" = a create-a-post ask (Part 2 format inference).
  const isCreate = /\b(add|create)\b\s+(?:a|an|another|some|the)?\s*(reel|carousel|single|post|photo|image|picture|video)\b/.test(lower);

  if (isCreate) {
    const format = /\b(reel|video)\b/.test(lower) ? 'reel'
      : /\b(carousel|slides|swipe)\b/.test(lower) ? 'carousel'
      : /\b(photo|image|picture)\b/.test(lower) ? 'single'
      : null;                                   // no signal → route defaults to single (visible note)
    // Pin to a free in-window July day so the created post is visible on the calendar for
    // the e2e (defaultAddDate would land it in August, off-view).
    const add: Record<string, unknown> = { action: 'add_post', toDate: '2026-07-15', instruction: fakeTopic(clientMsg), reason: clientMsg.trim() };
    if (format) add.format = format;
    // Compound "… with a good hook" → a second generate_hook task (no post ref → links to
    // the add above at the route). For a single-image create the route turns it into
    // product-aware guidance instead of a proposal.
    return wantsHook ? [add, { action: 'generate_hook', reason: 'with a good hook' }] : [add];
  }

  // Hooks for an EXISTING post (no create verb). A "photo/image" reference targets the
  // seeded single-image post (→ product-aware "hooks apply to reels/carousels"); otherwise
  // the seeded reel (→ a valid generate_hook proposal).
  if (wantsHook) {
    const single = /\b(photo|image|picture|single)\b/.test(lower);
    return [{ action: 'generate_hook', postId: single ? E2E_SINGLE : E2E_REEL, reason: 'generate hooks' }];
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

/** The text between two markers. Called with the same marker twice for the task parser's
 *  triple-quoted client message, and with a distinct open/close for the classifier's prompt. */
function between(s: string, open: string, close = open): string {
  const a = s.indexOf(open);
  if (a === -1) return '';
  const b = s.indexOf(close, a + open.length);
  return b === -1 ? '' : s.slice(a + open.length, b);
}

/** The caption a faked shape job writes, so "shape pending → caption swaps" is
 *  deterministic without Redis/Bedrock. */
export const E2E_SHAPED_CAPTION =
  'We’ve been quietly working on this one and it’s finally ready to share. Come and see it — link in bio.';

/**
 * The hook a faked SCRIPT job writes alongside its script.
 *
 * A reel's hook and script are ONE act (C4): the real job writes a coherent pair and the script
 * grounds on the chosen hook verbatim. The fake wrote only the script, so the combined path
 * could not be observed end to end — the hook tab stayed empty after a generate, and three of
 * the standing desktop e2e failures were that and nothing else.
 *
 * It is the script's own opening line, which is what "grounds on the hook verbatim" means.
 */
export const E2E_PAIR_HOOK = 'The real reason this top sold out twice — and it isn’t the fabric.';

/** The 3 hook candidates a faked hook job returns — deterministic for e2e. */
export const E2E_HOOK_CANDIDATES = [
  'The real reason this top sold out twice — and it isn’t the fabric.',
  'Stop washing linen like cotton. Do this instead.',
  'POV: you’re the friend whose outfit everyone quietly asks about.',
];

/**
 * A deterministic 15-day forecast (today + 14) for the weather overlay e2e, anchored
 * to the frozen PLAN_TODAY (2026-07-08 → window 07-08…07-22). Codes span the icon buckets
 * (sun / partly / overcast / rain / heavy-rain / thunder / snow / fog) and the temps span
 * the tone bands so the §22 heat/cold treatments render deterministically:
 *   · i=6  2026-07-14 — code 71 (snow) at 1° → cold band (slate-blue label).
 *   · i=8  2026-07-16 — code 0 (clear) at 33° → scorcher (amber label + hot-sun glyph).
 *   · i=12 2026-07-20 — code 1 ("mainly clear") → SUN bucket, proving 1 ≠ cloud.
 *   · i=13 2026-07-21 — code 0 (clear) at 29° → hot band (amber label, normal sun).
 * Days outside this window get no entry, so they render nothing.
 */
const E2E_WEATHER_CODES = [0, 2, 3, 61, 65, 95, 71, 45, 0, 2, 3, 80, 1, 0, 3];
const E2E_WEATHER_TEMPS = [24, 22, 19, 17, 16, 20, 1, 15, 33, 23, 18, 17, 21, 29, 19];
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

/** The canned field text a faked REFINE job writes (§26) — distinct from the generated
 *  text so an e2e can assert the field actually changed. */
export const E2E_REFINED_HOOK = 'Sold out twice. The reason isn’t the fabric.';
export const E2E_REFINED_SCRIPT =
  'HOOK: Sold out twice. The reason isn’t the fabric.\n\n' +
  'BEAT 1 (0–4s) — Hands turn the weave to the light. (macro)\n' +
  'BEAT 2 (4–18s) — One honest line on why we chose this cloth. (studio)\n\n' +
  'CTA: Back in stock this week. Link in bio.';
