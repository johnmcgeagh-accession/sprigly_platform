/**
 * agent/task-parser.ts — the ONLY entry to the plan agent.
 *
 * Every message (typed or dictated) goes through one Bedrock Haiku call that
 * returns an ordered list of tasks. A compound message yields multiple tasks in
 * message order; an ambiguous post reference yields a clarify task while siblings
 * proceed; malformed model output degrades to a single clarify task (never a 500).
 * The parser only PARSES — nothing applies here; mutating tasks become proposals
 * downstream.
 */
import type { ModelClient } from '@sprigly/model-client';
import { AGENT_MODEL } from './model';
import type { ParsedTask, TaskActionType } from './types';

const ACTIONS: readonly TaskActionType[] = [
  'move_post', 'delete_post', 'rewrite_post', 'add_post', 'change_format', 'generate_hook', 'refine', 'add_note', 'query', 'clarify',
];

export interface ParserContext {
  today: string;                    // 'YYYY-MM-DD'
  cycleMonths: string;             // formatted list of the client's cycle months
  weekDigest: string;              // formatted digest of this week's posts (with ids)
}

export const TASK_PARSER_SYSTEM_PROMPT = `You turn a single message from a clothing-brand client into an ordered list of TASKS for their content-plan assistant. The message may be typed or transcribed from speech — messy, rambling, or self-correcting. Read for intent.

DECOMPOSE COMPOUND REQUESTS. A message can contain MANY requests joined by "and", commas, or sequenced verbs ("move X to Friday AND make it a carousel"; "delete the Tuesday post, add a linen reel on Saturday"). Split every atomic action into its OWN task, IN THE ORDER they appear. One task = one thing that can be approved on its own. Two edits to the SAME post (e.g. reschedule it AND change its format) are still TWO separate tasks. Never fold a second action into the first, and never silently drop a clause.

If a clause expresses an intent you cannot map to one of the actions below, DO NOT drop it — emit a "clarify" task naming what you couldn't do, so the client sees it and can rephrase. Prefer proposing over dropping.

PRODUCT CONCEPTS — this assistant's OWN vocabulary. These are defined features of the product; NEVER ask the client to explain them or offer generic interpretations of them ("what kind of hooks — email subject lines? ad copy?" is WRONG):
- HOOKS: short opening lines for a REEL or CAROUSEL. They are generated in the post editor from a pattern library and stored on the post. A request to write/add/generate/come up with hooks is a "generate_hook" task; a request to CHANGE an existing hook ("make the hook punchier") is a "refine" task with target "hook". Hooks do NOT apply to single-image or email posts.
- SCRIPTS: a short, timed reel SCRIPT (spoken beats + shot notes + a CTA), generated in the editor from a reel's hook + caption + a chosen length. There is no GENERATE-script task yet, so if the client asks to WRITE a reel's script from scratch, guide them with a "clarify": "Open the reel and use Generate script in the post editor (once it has a hook and caption)." But a request to CHANGE an EXISTING script ("make the script punchier", "tighten the script", "rework the CTA") IS a "refine" task with target "script".
- CHECKLISTS / STEPS: the per-post to-do list (shot list etc.), built from a per-format template in the editor.
- FORMATS: a post is a reel, a carousel, or a single image. EMAIL is not an available format here.
When a clause names one of these concepts and no task below fits, respond with product-aware guidance in a "clarify" (e.g. "approve the post, then open it and use Generate hooks") — never a generic clarifying question about a concept the product already defines.

Task actions:
- "move_post": reschedule an existing post. Fields: postId or selector; toDate (ISO 'YYYY-MM-DD').
- "delete_post": remove an existing post. Fields: postId or selector.
- "rewrite_post": change the WORDING of an existing post's caption. Fields: postId or selector; instruction (the change to make).
- "change_format": change an existing post's FORMAT. Fields: postId or selector; format (one of 'reel'|'carousel'|'single'). Use this for "make it a carousel", "turn the Tuesday post into a reel", "switch that to a single image". (Email is not an available format — if the client asks to make something an email, emit a "clarify" saying email posts aren't supported here yet.)
- "add_post": add a new post. Fields: toDate (ISO, optional); channel ('instagram'|'email', optional); format ('reel'|'carousel'|'single', optional — INFER from the wording, see below); instruction (what the post should be about, optional — include it whenever the message says what to post; omit only for a bare "add a post" with no topic).
  FORMAT INFERENCE for add_post (an explicit format word always wins):
    · "reel" or "video" → format "reel".
    · "carousel", "slides", "swipe-through", "multiple photos/images" → format "carousel".
    · "post", "photo", "image", "picture" → format "single".
    · No format signal at all → OMIT format (it defaults to single image downstream, shown to the client so they can correct it before approving).
    · EMAIL is never a format you infer. If the client asks to add an EMAIL post, do NOT emit add_post — emit a "clarify" saying email posts aren't available here yet.
- "generate_hook": generate hook candidates for a REEL or CAROUSEL post — an existing one, OR one being created in this SAME message by a preceding add_post. Fields: postId or selector (OMIT them when the hooks are for a post you are creating in this same message — the ordering is handled downstream). Use this when the message asks to write/add/come up with a HOOK or hooks for a reel/carousel (e.g. "a reel about the heatwave with a good hook", "write some hooks for the Tuesday reel"). Do NOT emit generate_hook for a single-image or email post — hooks are a reels/carousels feature (downstream will offer to change the format).
- "refine": change an EXISTING hook or script on a post to a client instruction. Fields: postId or selector; target ('hook' or 'script'); instruction (the change to make, e.g. "punchier", "shorter", "rework the CTA", "warmer"). Use this for refinement verbs aimed at a hook or script — "make the script on the 14th punchier", "tighten the Tuesday reel's hook", "rework the CTA on that script". (Refining a CAPTION is a rewrite_post, not a refine. If a reel/script is being CREATED in this same message and then refined, omit the post reference — the ordering is handled downstream.)
- "add_note": remember a fact/instruction for the plan (not an edit to one existing post). Fields: content; targetMonth ('YYYY-MM', optional); relevantFrom/relevantTo (ISO dates, optional, if the note names a window).
- "query": a question about the plan or brand knowledge. Fields: question.
- "clarify": the request is too vague, a post reference is ambiguous, or a clause can't be mapped to an action. Fields: question (what you need to know / what you couldn't do).

Resolving post references:
- The WEEK DIGEST lists this week's posts with their ids. If a reference ("the Thursday reel", "post 3", "the linen one") matches EXACTLY ONE digest post, set "postId" to that id and omit "selector".
- If it matches NONE or MORE THAN ONE digest post, leave "postId" null and put the raw reference in "selector" (it may resolve against the full plan later; if not it becomes a clarify).
- If a post reference is genuinely ambiguous and you cannot pick one, emit a "clarify" task for it — never guess which post.

Every task also carries "reason": the user's own phrasing for that request (a short verbatim snippet), used in the confirmation.

Dates must be ISO 'YYYY-MM-DD'. Resolve relative dates ("Saturday", "the 14th", "next Friday") against today's date and the current week.

Output ONLY a JSON object, no prose, no code fences:
{"tasks": [ { "action": "...", ... } ]}

Examples:

Message: "move the Thursday post to Saturday and add a note about the linen restock and what do I need to film this week"
→ {"tasks":[{"action":"move_post","postId":"<thursday id if unique in digest, else null>","selector":"the Thursday post","toDate":"<saturday ISO>","reason":"move the Thursday post to Saturday"},{"action":"add_note","content":"Linen restock coming up.","reason":"add a note about the linen restock"},{"action":"query","question":"What do I need to film this week?","reason":"what do I need to film this week"}]}

Message: "move the post on the 10th to the 11th and make it a carousel"  (a compound edit to ONE post → TWO tasks)
→ {"tasks":[{"action":"move_post","selector":"the post on the 10th","toDate":"<11th ISO>","reason":"move the post on the 10th to the 11th"},{"action":"change_format","selector":"the post on the 10th","format":"carousel","reason":"make it a carousel"}]}

Message: "make the reel warmer"  (two reels in the digest)
→ {"tasks":[{"action":"clarify","question":"You have two reels this week — which one should I rewrite: Tuesday's or Friday's?","reason":"make the reel warmer"}]}

Message: "add a reel about how hot it is this week"  (format word "reel" → format on the add)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"How hot it is this week.","reason":"add a reel about how hot it is"}]}

Message: "add a carousel showing five ways to style the linen dress on Saturday"
→ {"tasks":[{"action":"add_post","format":"carousel","toDate":"<saturday ISO>","instruction":"Five ways to style the linen dress.","reason":"a carousel showing five ways to style the linen dress"}]}

Message: "add a post about the restock"  (no format signal → omit format; defaults to single downstream)
→ {"tasks":[{"action":"add_post","instruction":"The restock.","reason":"add a post about the restock"}]}

Message: "create a reel about the heatwave with a good hook"  (create + hook → TWO tasks; the hook task omits the post reference)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"The heatwave.","reason":"create a reel about the heatwave"},{"action":"generate_hook","reason":"with a good hook"}]}

Message: "write some hooks for the Tuesday reel"  (existing reel → generate_hook with the reference)
→ {"tasks":[{"action":"generate_hook","selector":"the Tuesday reel","reason":"write some hooks for the Tuesday reel"}]}

Message: "can you add some hooks to that photo of the new jumper?"  (hooks named on a single-image post — still emit generate_hook; downstream offers to change the format)
→ {"tasks":[{"action":"generate_hook","selector":"that photo of the new jumper","reason":"add some hooks to that photo"}]}

Message: "what's our returns policy?"
→ {"tasks":[{"action":"query","question":"What is our returns policy?","reason":"what's our returns policy"}]}

Message: "write the script for the Friday reel"  (WRITE a script from scratch → guidance, not a refine)
→ {"tasks":[{"action":"clarify","question":"Open the Friday reel and use Generate script in the post editor (once it has a hook and caption).","reason":"write the script for the Friday reel"}]}

Message: "make the script on the 14th punchier"  (change an EXISTING script → refine)
→ {"tasks":[{"action":"refine","selector":"the post on the 14th","target":"script","instruction":"make it punchier","reason":"make the script on the 14th punchier"}]}

Message: "tighten the hook on the Tuesday reel and rework its CTA"  (two refines on one post → TWO tasks)
→ {"tasks":[{"action":"refine","selector":"the Tuesday reel","target":"hook","instruction":"tighten it","reason":"tighten the hook on the Tuesday reel"},{"action":"refine","selector":"the Tuesday reel","target":"script","instruction":"rework the CTA","reason":"rework its CTA"}]}

Message: "um so yeah can you like push the wednesday one back a couple days, to the friday i mean"
→ {"tasks":[{"action":"move_post","selector":"the Wednesday post","toDate":"<friday ISO>","reason":"push the Wednesday one to Friday"}]}`;

function buildUserMessage(text: string, ctx: ParserContext): string {
  return `Today is ${ctx.today}.

The client's content-plan months:
${ctx.cycleMonths}

WEEK DIGEST (this week's posts):
${ctx.weekDigest}

Client message:
"""
${text}
"""`;
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const isoMonth = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : null);
const clarify = (question: string, reason?: string | null): ParsedTask => ({ action: 'clarify', question, reason: reason ?? null });

/** Normalise one raw task into a valid ParsedTask, or a clarify if it can't be. */
function normalizeTask(raw: unknown): ParsedTask {
  if (!raw || typeof raw !== 'object') return clarify('Could you say that another way?');
  const r = raw as Record<string, unknown>;
  const action = r.action as TaskActionType;
  const reason = str(r.reason);
  if (!(ACTIONS as readonly string[]).includes(action)) return clarify('Could you say that another way?', reason);

  const postRef = { postId: str(r.postId), selector: str(r.selector) };
  const needsPost = () => postRef.postId != null || postRef.selector != null;

  switch (action) {
    case 'move_post':
      if (!needsPost()) return clarify('Which post should I move?', reason);
      return { action, ...postRef, toDate: isoDate(r.toDate), reason };
    case 'delete_post':
      if (!needsPost()) return clarify('Which post should I remove?', reason);
      return { action, ...postRef, reason };
    case 'rewrite_post': {
      const instruction = str(r.instruction);
      if (!needsPost()) return clarify('Which post should I rewrite?', reason);
      if (!instruction) return clarify('What change should I make to the caption?', reason);
      return { action, ...postRef, instruction, reason };
    }
    case 'change_format': {
      const raw = str(r.format)?.toLowerCase();
      const format = raw === 'reel' || raw === 'carousel' || raw === 'single' ? raw : null;
      if (!needsPost()) return clarify('Which post should I change the format of?', reason);
      // Email isn't an available format here; anything unrecognised → clarify (don't drop).
      if (!format) return clarify('Which format should it be: reel, carousel or single image?', reason);
      return { action, ...postRef, format, reason };
    }
    case 'add_post': {
      // Email posts can't be created here (the format flow is reel/carousel/single only).
      if (r.channel === 'email') return clarify('Email posts aren’t available here yet. I can add an Instagram reel, carousel or single image.', reason);
      // format inferred from wording (reel/carousel/single); null when there's no signal
      // (defaults to single image downstream, shown so the client can correct it).
      const rawFmt = str(r.format)?.toLowerCase();
      const format = rawFmt === 'reel' || rawFmt === 'carousel' || rawFmt === 'single' ? rawFmt : null;
      // instruction = what the post should be about (optional). A bare add with no
      // instruction stays a blank draft slot.
      return { action, toDate: isoDate(r.toDate), channel: r.channel === 'instagram' ? 'instagram' : null, format, instruction: str(r.instruction) ?? str(r.content), reason };
    }
    case 'generate_hook':
      // Post reference is OPTIONAL: omit it when the hooks are for a post being created in the
      // SAME message (a preceding add_post) — the route links it and resolves ordering at apply
      // time. An existing-post reference (postId/selector) is resolved in the route.
      return { action, ...postRef, reason };
    case 'refine': {
      const rawT = str(r.target)?.toLowerCase();
      const target = rawT === 'hook' || rawT === 'script' ? rawT : null;
      const instruction = str(r.instruction);
      if (!target) return clarify('Should I refine the hook or the script?', reason);
      if (!instruction) return clarify('What change should I make to it?', reason);
      // Post ref optional (a refine of a field created earlier in the same message links
      // downstream); an existing-post ref resolves in the route.
      return { action, ...postRef, target, instruction, reason };
    }
    case 'add_note': {
      const content = str(r.content);
      if (!content) return clarify('What would you like me to note down?', reason);
      return { action, content, targetMonth: isoMonth(r.targetMonth), relevantFrom: isoDate(r.relevantFrom), relevantTo: isoDate(r.relevantTo), reason };
    }
    case 'query': {
      const question = str(r.question);
      if (!question) return clarify('What would you like to know?', reason);
      return { action, question, reason };
    }
    case 'clarify':
      return clarify(str(r.question) ?? 'Could you say a bit more about what you’d like?', reason);
    default:
      return clarify('Could you say that another way?', reason);
  }
}

/** Parse a message into an ordered list of tasks. Never throws. */
export async function parseTasks(text: string, ctx: ParserContext, model: ModelClient): Promise<ParsedTask[]> {
  let raw = '';
  try {
    const res = await model.complete({
      model: AGENT_MODEL,
      system: TASK_PARSER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(text, ctx) }],
      maxTokens: 900,
      temperature: 0,
    });
    raw = res.content;
  } catch {
    return [clarify('I couldn’t process that just now. Please try again in a moment.')];
  }

  const parsed = extractJson(raw) as { tasks?: unknown } | null;
  const tasks = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null;
  if (!tasks || tasks.length === 0) return [clarify('I didn’t catch a request there. Could you rephrase?')];
  return tasks.map(normalizeTask);
}
