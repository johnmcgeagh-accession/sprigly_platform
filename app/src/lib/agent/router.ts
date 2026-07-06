/**
 * agent/router.ts — intent routing for the plan agent.
 *
 * Two-tier: the deterministic regex classifier (classifyAgentInstruction) is the
 * FAST PATH for typed input — free, zero-latency, and unchanged. When the input
 * is dictated (source='voice') or the regex can't confidently route (it returns
 * 'clarify'), we escalate to the LLM router (Bedrock Haiku, single JSON response,
 * temperature 0), which handles messy speech and the capture/query intents the
 * regex vocabulary doesn't cover.
 *
 * The LLM only CLASSIFIES + cleans. Action intents (structural/add/rewrite) are
 * then run back through the deterministic classifier so they flow into the exact
 * existing mutation + shape-job pipeline. Capture intents become proposals; query
 * runs the retrieval answerer.
 */
import type { ModelClient } from '@sprigly/model-client';
import { classifyAgentInstruction, type AgentPlan } from '../agent-classify';
import type { PlanPost } from '../types';
import { AGENT_MODEL } from './model';
import type { RouterIntent, RouterResult } from './types';

const ROUTER_INTENTS: readonly RouterIntent[] = [
  'note_for_month', 'idea_backlog', 'next_cycle_input', 'structural', 'add', 'rewrite', 'query', 'clarify',
];

export interface CycleMonthContext {
  month: string;    // 'YYYY-MM'
  label: string;    // 'July 2026'
  status: string;
  isHome: boolean;  // the one editable month (the session's cycle)
}

export interface RouterContext {
  today: string;                    // 'YYYY-MM-DD'
  cycleMonths: CycleMonthContext[]; // the client's known cycles, home first
}

export const ROUTER_SYSTEM_PROMPT = `You classify a single message a clothing-brand client sends to their content-plan assistant. The message may be typed or transcribed from speech, so it can be messy, rambling, or self-correcting — read for intent, not literal wording.

Classify into exactly one intent:
- "structural": a concrete edit to an existing planned post's structure — move/reschedule, change format (reel/carousel/single), reorder, or delete. E.g. "move Tuesday's post to Friday", "make the reel a carousel", "delete the post on the 12th".
- "add": add a new post to the current plan. E.g. "add a post about the new arrivals".
- "rewrite": change the WORDING of an existing post's caption. E.g. "make the Tuesday post warmer", "shorten that caption".
- "note_for_month": a fact or instruction to remember for a SPECIFIC month's plan that is not an edit to a specific existing post. E.g. "we're launching the wool coat on the 14th", "remember the sale ends the 20th".
- "idea_backlog": a loose content idea to keep for later, not tied to a month. E.g. "idea: a behind-the-scenes reel of the studio".
- "next_cycle_input": guidance aimed at a FUTURE month's plan. E.g. "for next month, lean into knitwear", "next cycle do more styling posts".
- "query": a question about the current plan or the brand's knowledge. E.g. "what's scheduled this week?", "what's our returns policy?".
- "clarify": the message is too vague or off-topic to act on.

Extract:
- "content": the cleaned instruction or text, filler removed, self-corrections resolved. For a note/idea/next_cycle this is the thing to remember. For an action this is a clean instruction. For a query this is the question.
- "target_month": 'YYYY-MM' if the client named or implied a specific month, else null.
- "channel": 'instagram' or 'email' if named, else null.

Prefer an action intent (structural/add/rewrite) only when the client clearly wants to change an existing planned post NOW. When in doubt between an action and a note, choose note_for_month or clarify — never guess an edit.

Output ONLY a JSON object, no prose, no code fences:
{"intent": "...", "content": "...", "target_month": null, "channel": null}`;

function buildUserMessage(text: string, ctx: RouterContext): string {
  const months = ctx.cycleMonths.length
    ? ctx.cycleMonths.map((c) => `- ${c.label} (${c.month})${c.isHome ? ' [current, editable]' : ''} — ${c.status}`).join('\n')
    : '- (no cycles on record)';
  return `Today is ${ctx.today}.
The client's content-plan months:
${months}

Client message:
"""
${text}
"""`;
}

/** Pull the first balanced {...} JSON object out of a model response. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRouterIntent(v: unknown): v is RouterIntent {
  return typeof v === 'string' && (ROUTER_INTENTS as readonly string[]).includes(v);
}

const clarifyFallback = (content = 'Sorry, I didn’t quite catch that — could you say it another way?'): RouterResult => ({
  intent: 'clarify', content, targetMonth: null, channel: null,
});

/** Call the LLM router and return a validated RouterResult. Never throws — a
 *  malformed/parse-failed response degrades to a safe clarify. */
export async function runLlmRouter(text: string, ctx: RouterContext, model: ModelClient): Promise<RouterResult> {
  let raw = '';
  try {
    const res = await model.complete({
      model: AGENT_MODEL,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(text, ctx) }],
      maxTokens: 400,
      temperature: 0,
    });
    raw = res.content;
  } catch {
    return clarifyFallback('I couldn’t process that just now — please try again.');
  }

  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || !isRouterIntent(parsed.intent)) return clarifyFallback();

  const content = typeof parsed.content === 'string' && parsed.content.trim() ? parsed.content.trim() : text.trim();
  const targetMonth = typeof parsed.target_month === 'string' && /^\d{4}-\d{2}$/.test(parsed.target_month) ? parsed.target_month : null;
  const channel = parsed.channel === 'instagram' || parsed.channel === 'email' ? parsed.channel : null;

  return { intent: parsed.intent, content, targetMonth, channel };
}

export type RouteOutcome =
  | { via: 'regex'; plan: AgentPlan }
  | { via: 'llm'; result: RouterResult };

/**
 * Decide how to handle a message. Typed input tries the deterministic classifier
 * first and uses it when confident (anything but 'clarify'); voice input, and any
 * unconfident typed input, goes to the LLM router.
 */
export async function routeInstruction(
  text: string,
  posts: PlanPost[],
  selectedId: string | undefined,
  source: 'web' | 'voice',
  ctx: RouterContext,
  model: ModelClient,
): Promise<RouteOutcome> {
  if (source === 'web') {
    const fast = classifyAgentInstruction(text, posts, selectedId);
    if (fast.kind !== 'clarify') return { via: 'regex', plan: fast };
  }
  const result = await runLlmRouter(text, ctx, model);
  return { via: 'llm', result };
}
