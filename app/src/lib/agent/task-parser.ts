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
  /** The month the client is LOOKING at, e.g. 'August 2026'. Bare references ("the 5th") resolve
   *  here first — the digest below is this month's, and saying so is what stops the parser
   *  reasoning about one month while reading another's posts. */
  viewedMonth: string;
  cycleMonths: string;             // formatted list of the client's cycle months
  planDigest: string;              // formatted digest of the whole cycle's posts, by date (with ids)
  productIndex: string;            // formatted index of the client's products (name/style/colourways)
  /** The conversation so far — a bounded window of recent turns (threadForParser), assistant
   *  turns serialised from their RESOLVED items. Empty/absent on a fresh thread. This is what
   *  lets "move it back" and "that one" resolve against the previous exchange. */
  recentThread?: string;
}

export const TASK_PARSER_SYSTEM_PROMPT = `You turn a single message from a clothing-brand client into an ordered list of TASKS for their content-plan assistant. The message may be typed or transcribed from speech — messy, rambling, or self-correcting. Read for intent.

THE CLIENT CANNOT REPLY TO A TASK. Every task renders as an Approve/Discard suggestion or a dismissible notice — there is NO inline answer box. So NEVER phrase a task as a question waiting for an answer ("what should this focus on?", "which angle?", "what's the maebelle?"). If you are unsure what the client wants, emit your BEST-GUESS approvable action and name the alternatives in "reason" — a wrong guess costs the client one Discard, but an unanswerable question stalls the whole interaction with no way forward.

DECOMPOSE COMPOUND REQUESTS. A message can contain MANY requests joined by "and", commas, or sequenced verbs ("move X to Friday AND make it a carousel"; "delete the Tuesday post, add a linen reel on Saturday"). Split every atomic action into its OWN task, IN THE ORDER they appear. One task = one thing that can be approved on its own. Two edits to the SAME post (e.g. reschedule it AND change its format) are still TWO separate tasks. Never fold a second action into the first, and never silently drop a clause.

NEVER silently drop a clause. If a clause genuinely cannot be mapped to any action below, emit a "clarify" — but a "clarify" is a STATEMENT of what you couldn't map ("Couldn't map 'sponsor the 10k' to a plan change"), NEVER a question soliciting content, a topic, an angle, or wording. Reserve "clarify" for two cases only: (1) a clause that maps to no action at all, and (2) an ambiguous reference for a DESTRUCTIVE edit (move/delete) where guessing the wrong post would lose work. For everything else — a vague topic, a missing angle, an unspecified format — PROPOSE your best guess as a real action rather than asking.

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
  ANGLE DEFAULT for add_post: a named product, collection, drop, theme or event is a SUFFICIENT instruction on its own. If the client says WHAT to post about but not the ANGLE, emit the add_post with that as "instruction" (default the angle to introducing/showcasing it) — do NOT clarify. "a reel about the maebelle" → add_post, instruction "Introduce the Maebelle." The client sets the exact angle at approval.
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

Resolving product references:
- The CATALOGUE lists this client's products (name, style, colourways). Resolve a named product ("the maebelle", "the Anna vest", "the linen dress") against it. A product that matches the catalogue is FULLY SPECIFIED — emit the add_post with the product as its instruction and let the client refine the angle at approval. NEVER ask what a named product IS, or what a post about it should focus on. A product not in the catalogue is still a valid topic — propose it anyway; do not clarify just because it's unfamiliar.

Resolving post references:
- The PLAN DIGEST lists THIS CYCLE's posts (the whole plan month, by date) with their ids. If a reference ("the post from the 1st August", "the Thursday reel", "post 3", "the linen one") matches EXACTLY ONE digest post, set "postId" to that id AND ALSO keep the raw reference in "selector" (set BOTH — resolution needs the phrase as a fallback if the id is imperfect). Never say a post doesn't exist without checking the whole digest — it covers the full month, not just this week.
- For move_post, ALSO set "fromDate" to the SOURCE post's date (ISO 'YYYY-MM-DD') whenever the source is named by a date ("the post on the 1st", "move the 1st August one to..."). This is the reliable source key — always include it for a date-named source.
- If it matches NONE or MORE THAN ONE digest post, leave "postId" null and put the raw reference in "selector" (it may resolve against the full plan later; if not it becomes a clarify).
- If a post reference is genuinely ambiguous and you cannot pick one, emit a "clarify" task for it — never guess which post.

Every task also carries "reason": the user's own phrasing for that request (a short verbatim snippet), used in the confirmation.

DATES — THE RULE, AND THE ONE MISTAKE NEVER TO MAKE.
Dates must be ISO 'YYYY-MM-DD'. Every digest post carries its full ISO date, and the message opens with today's ISO date AND a table of the next 14 days with their weekdays — READ dates off that table rather than computing them.
- A date is in the PAST only when its ISO date is EARLIER than today's. Today itself, and every date after it, is NOT past. COMPARE THE ISO DATES — never reason from month names, and never assume a month that is not the one on screen has been and gone. If today is 2026-07-30, then 2026-08-14 is a FORTNIGHT AWAY, and 2026-07-29 is yesterday.
- The digest marks anything already past as '[past — read-only]'. If a row is not marked, it is not past. NEVER tell the client a date has passed unless its row says so.
- You do not enforce editability and you do not need to: a past-dated edit is refused downstream, in words that name the real date. Emit the action the client asked for.

THE CONVERSATION SO FAR — when the message includes a recent-thread block, it is one running conversation about this month, and the new message may refer BACK into it:
- "it", "that one", "the reel" with no other anchor → the post the conversation most recently acted on or discussed. Read the ASSISTANT lines: they state each change with the post's title and RESOLVED ISO dates.
- "move it back", "undo that", "put it back" after a move → a NEW move that reverses it: the source is the date the post is on NOW (the previous move's destination), the toDate is the previous move's SOURCE date. Emit a move_post with those dates — never a clarify asking which post.
- "actually make it a carousel" after an add or format change → the same post the thread just handled.
- The thread NEVER overrides the digest: the digest is the plan as it stands, the thread is how it got there. Resolve WHICH post from the thread; resolve WHERE it currently sits from the digest.

RELATIVE REFERENCES resolve against TODAY, from the day table:
- A bare weekday — "Friday's post", "the Friday post", "move Friday to Saturday" — means the NEXT such weekday from today (today itself counts when today is that weekday). Read its ISO date from the table and set fromDate/toDate accordingly. Do NOT ask which Friday; a wrong default costs one Discard because the resolved date is SHOWN to the client before anything applies. Ask only when the resolved DAY holds more than one post and the reference doesn't pick between them.
- "tomorrow" = the day after today; "next week" = the week starting the coming Monday; "the 14th" = the 14th of the month on screen (or the named month). All from the table and the viewed month — never from arithmetic you do in your head.

Output ONLY a JSON object, no prose, no code fences:
{"tasks": [ { "action": "...", ... } ]}

Examples:

Message: "move the Thursday post to Saturday and add a note about the linen restock and what do I need to film this week"
→ {"tasks":[{"action":"move_post","postId":"<thursday id if unique in digest, else null>","selector":"the Thursday post","toDate":"<saturday ISO>","reason":"move the Thursday post to Saturday"},{"action":"add_note","content":"Linen restock coming up.","reason":"add a note about the linen restock"},{"action":"query","question":"What do I need to film this week?","reason":"what do I need to film this week"}]}

Message: "move the post on the 10th to the 11th and make it a carousel"  (a compound edit to ONE post → TWO tasks; a date-named source → fromDate)
→ {"tasks":[{"action":"move_post","selector":"the post on the 10th","fromDate":"<10th ISO>","toDate":"<11th ISO>","reason":"move the post on the 10th to the 11th"},{"action":"change_format","selector":"the post on the 10th","format":"carousel","reason":"make it a carousel"}]}

Message: "move the post on the 1st August to the 22nd August"  (source named by date → set fromDate AND postId/selector)
→ {"tasks":[{"action":"move_post","postId":"<aug-1 post id from digest>","selector":"the post on the 1st August","fromDate":"<1 Aug ISO>","toDate":"<22 Aug ISO>","reason":"move the post on the 1st August to the 22nd August"}]}

Message: "make the reel warmer"  (two reels in the digest)
→ {"tasks":[{"action":"clarify","question":"You have two reels this week — which one should I rewrite: Tuesday's or Friday's?","reason":"make the reel warmer"}]}

Message: "add a reel about how hot it is this week"  (format word "reel" → format on the add)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"How hot it is this week.","reason":"add a reel about how hot it is"}]}

Message: "add a reel about the maebelle"  (a named product → fully specified; NEVER ask what it is or its angle)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"Introduce the Maebelle.","reason":"add a reel about the maebelle"}]}

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

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Today + the next 14 days, each with its weekday — the lookup table relative references
 * resolve from. Stating the table costs a few tokens and removes the entire class of failure
 * where a small model does calendar arithmetic in its head: "next Friday", "tomorrow" and
 * "the 14th" all become string lookups. Pure; exported for the fixtures.
 */
export function dayTable(todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const base = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const lines: string[] = [];
  for (let i = 0; i <= 14; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    lines.push(`- ${iso} = ${DOW[dt.getDay()]}${i === 0 ? ' (TODAY)' : i === 1 ? ' (tomorrow)' : ''}`);
  }
  return lines.join('\n');
}

function buildUserMessage(text: string, ctx: ParserContext): string {
  return `TODAY IS ${ctx.today} (ISO). Anything later than that is in the future; only earlier dates are past.

THE NEXT 14 DAYS (resolve every relative reference from this table):
${dayTable(ctx.today)}

The client is looking at ${ctx.viewedMonth}. Resolve bare dates ("the 5th", "Saturday") in ${ctx.viewedMonth} unless they name another month.
${ctx.recentThread ? `
THE CONVERSATION SO FAR (oldest first — "it"/"move it back" resolve against this):
${ctx.recentThread}
` : ''}

The client's content-plan months (every one of these is theirs to work on; a post can be changed whenever its own date is today or later, whatever the month's status says):
${ctx.cycleMonths}

PLAN DIGEST — ${ctx.viewedMonth}, the month on screen (by date):
${ctx.planDigest}

CATALOGUE (this client's products):
${ctx.productIndex}

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
  // Clarify copy below is deliberately a STATEMENT of what couldn't be resolved plus a
  // resend path — never a question. The client can't reply to a task in place, but they
  // CAN send a fresh message, so we tell them what to send.
  if (!raw || typeof raw !== 'object') return clarify('I couldn’t map that to a plan change — send another message rephrasing it.');
  const r = raw as Record<string, unknown>;
  const action = r.action as TaskActionType;
  const reason = str(r.reason);
  if (!(ACTIONS as readonly string[]).includes(action)) return clarify('I couldn’t map that to a plan change — send another message rephrasing it.', reason);

  const postRef = { postId: str(r.postId), selector: str(r.selector) };
  const needsPost = () => postRef.postId != null || postRef.selector != null;

  switch (action) {
    case 'move_post': {
      const fromDate = isoDate(r.fromDate);
      if (!needsPost() && !fromDate) return clarify('I couldn’t tell which post to move — send another message naming its date or the product.', reason);
      return { action, ...postRef, fromDate, toDate: isoDate(r.toDate), reason };
    }
    case 'delete_post':
      if (!needsPost()) return clarify('I couldn’t tell which post to remove — send another message naming its date or the product.', reason);
      return { action, ...postRef, reason };
    case 'rewrite_post': {
      const instruction = str(r.instruction);
      if (!needsPost()) return clarify('I couldn’t tell which post to rewrite — send another message naming its date or the product.', reason);
      if (!instruction) return clarify('I couldn’t tell what caption change to make — send another message with the wording change you want.', reason);
      return { action, ...postRef, instruction, reason };
    }
    case 'change_format': {
      const raw = str(r.format)?.toLowerCase();
      const format = raw === 'reel' || raw === 'carousel' || raw === 'single' ? raw : null;
      if (!needsPost()) return clarify('I couldn’t tell which post to reformat — send another message naming its date or the product.', reason);
      // Email isn't an available format here; anything unrecognised → clarify (don't drop).
      if (!format) return clarify('I couldn’t tell which format you meant — send another message saying reel, carousel or single image.', reason);
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
      if (!target) return clarify('I couldn’t tell whether you meant the hook or the script — send another message saying which.', reason);
      if (!instruction) return clarify('I couldn’t tell what change to make to it — send another message with the change you want.', reason);
      // Post ref optional (a refine of a field created earlier in the same message links
      // downstream); an existing-post ref resolves in the route.
      return { action, ...postRef, target, instruction, reason };
    }
    case 'add_note': {
      const content = str(r.content);
      if (!content) return clarify('I couldn’t tell what to note down — send another message with the note.', reason);
      return { action, content, targetMonth: isoMonth(r.targetMonth), relevantFrom: isoDate(r.relevantFrom), relevantTo: isoDate(r.relevantTo), reason };
    }
    case 'query': {
      const question = str(r.question);
      if (!question) return clarify('I couldn’t tell what you wanted to know — send another message with the question.', reason);
      return { action, question, reason };
    }
    case 'clarify':
      return clarify(str(r.question) ?? 'I couldn’t map that to a plan change — send another message with a bit more detail.', reason);
    default:
      return clarify('I couldn’t map that to a plan change — send another message rephrasing it.', reason);
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
    return [clarify('I couldn’t process that just now — send it again in a moment.')];
  }

  const parsed = extractJson(raw) as { tasks?: unknown } | null;
  const tasks = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null;
  if (!tasks || tasks.length === 0) return [clarify('I didn’t catch a request there — send another message with what you’d like to change.')];
  return tasks.map(normalizeTask);
}
