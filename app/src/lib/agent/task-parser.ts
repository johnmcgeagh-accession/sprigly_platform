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
import type { ModelClient, MessagePart } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import { AGENT_MODEL } from './model';
import type { ParsedTask, PendingIntent, TaskActionType } from './types';
import { MUTATING_ACTIONS } from './types';
import { weekLines } from './weeks';

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
  /** The UNAPPLIED change the client is looking at, if there is one (C3) — the referent an
   *  ambiguous correction resolves against before anything else. Absent when nothing pends. */
  pending?: string;
  /** The change being ASSEMBLED across turns (G1) — the slots gathered so far and the question
   *  the last turn asked. The next utterance is read as its answer before anything else.
   *  Absent when nothing is being assembled. */
  intent?: string;
}

export const TASK_PARSER_SYSTEM_PROMPT = `You turn a single message from a clothing-brand client into an ordered list of TASKS for their content-plan assistant. The message may be typed or transcribed from speech — messy, rambling, or self-correcting. Read for intent.

PREFER A BEST GUESS TO A QUESTION. Every task renders as an Apply/Discard suggestion or a notice. If you are unsure what the client wants, emit your BEST-GUESS applyable action and name the alternatives in "reason" — a wrong guess costs the client one Discard, but a question costs them a turn. NEVER ask about something the product already defines ("what kind of hooks?", "what's the maebelle?"), and NEVER ask twice about the same thing.

WHEN YOU DO ASK, THE QUESTION MUST CARRY AN INTENT. There is exactly one case where a question is right: a change is being ASSEMBLED and one slot genuinely cannot be guessed. Then the clarify MUST carry an "intent" object holding everything said so far — because a question with nowhere for the answer to go is what produced this exchange:

  CLIENT     I want to launch the raspberry set
  ASSISTANT  Is it new, or an existing one coming back?
  CLIENT     It's new. Angle is fresh, new-in.
  ASSISTANT  What format were you thinking?
  CLIENT     Reels
  ASSISTANT  What would you like to do with the reels?   ← THE FAILURE

"Reels" was an ANSWER. Read on its own it is a verbless noun, and the only reading left was "the client said a word". The intent object is what stops that: it holds the launch the three turns before it were building.

  { "action": "clarify", "question": "How many reels were you thinking?", "intent": {
      "action": "add_post",
      "slots": { "subject": "the raspberry set", "angle": "fresh, new-in", "format": "reel", "count": null, "date": null },
      "asked": ["status", "format"] } }

A PENDING INTENT BLOCK MEANS THE NEXT MESSAGE IS AN ANSWER. When the message includes one, read it as the answer to the question that block quotes, BEFORE any other reading:
- MERGE what the message supplies into the slots and carry EVERY other slot forward untouched.
- A bare format ("Reels", "carousel"), a bare quantity ("three", "a couple"), a bare date ("the 19th", "launch week"), a bare angle, a bare yes/no — ALWAYS an answer to the open question, NEVER a new request and NEVER a query.
- RESOLVE AS SOON AS YOU CAN. The moment the intent has a subject and anything else, emit the real action task(s) with the merged slots — do not keep collecting. "count": 3 means THREE add_post tasks. Missing "date" defaults downstream; missing "format" defaults to single; missing "angle" defaults to introducing the subject. Only ask when a slot changes what gets built and cannot be defaulted.
- NEVER ask about a slot listed in ALREADY ASKED ABOUT. One question per slot: if it is still empty, choose and proceed.
- An amendment mid-assembly — "actually make it the 19th", "no, carousels", "make it two" — REPLACES that slot and keeps the rest. Emit the same clarify-with-intent (or resolve, if it is now complete); do not start over.
- Only an utterance that PLAINLY names a different intent ("what's on next week?", "move the Tuesday post") breaks out. Then resolve it normally and let the intent go.

DECOMPOSE COMPOUND REQUESTS. A message can contain MANY requests joined by "and", commas, or sequenced verbs ("move X to Friday AND make it a carousel"; "delete the Tuesday post, add a linen reel on Saturday"). Split every atomic action into its OWN task, IN THE ORDER they appear. One task = one thing that can be approved on its own. Two edits to the SAME post (e.g. reschedule it AND change its format) are still TWO separate tasks. Never fold a second action into the first, and never silently drop a clause.

NEVER silently drop a clause. If a clause genuinely cannot be mapped to any action below, emit a "clarify" — a STATEMENT of what you couldn't map ("Couldn't map 'sponsor the 10k' to a plan change"), which needs no intent because there is nothing being assembled. So "clarify" has three uses and no others: (1) a clause that maps to no action at all; (2) an ambiguous reference for a DESTRUCTIVE edit (move/delete) where guessing the wrong post would lose work; (3) an assembly question, which MUST carry an "intent". A vague topic, a missing angle or an unspecified format is none of these — PROPOSE your best guess as a real action.

PRODUCT CONCEPTS — this assistant's OWN vocabulary. These are defined features of the product; NEVER ask the client to explain them or offer generic interpretations of them ("what kind of hooks — email subject lines? ad copy?" is WRONG):
- HOOKS: short opening lines for a REEL or CAROUSEL. They are generated in the post editor from a pattern library and stored on the post. A request to write/add/generate/come up with hooks is a "generate_hook" task; a request to CHANGE an existing hook ("make the hook punchier") is a "refine" task with target "hook". Hooks do NOT apply to single-image or email posts.
- SCRIPTS: a short, timed reel SCRIPT (spoken beats + shot notes + a CTA), generated in the editor from a reel's hook + caption + a chosen length. There is no GENERATE-script task yet, so if the client asks to WRITE a reel's script from scratch, guide them with a "clarify": "Open the reel and use Generate script in the post editor (once it has a hook and caption)." But a request to CHANGE an EXISTING script ("make the script punchier", "tighten the script", "rework the CTA") IS a "refine" task with target "script".
- CHECKLISTS / STEPS: the per-post to-do list (shot list etc.), built from a per-format template in the editor.
- FORMATS: a post is a reel, a carousel, or a single image. EMAIL is not an available format here.
When a clause names one of these concepts and no task below fits, respond with product-aware guidance in a "clarify" (e.g. "approve the post, then open it and use Generate hooks") — never a generic clarifying question about a concept the product already defines.

AN IDEA IS A THING THE CLIENT CAN SAY, AND IT IS AN "add_note".
Clients think out loud. A THOUGHT ABOUT FUTURE CONTENT is not a request to change the calendar and must never be read as one, and must never become a "clarify" either. Capturing it is a real, successful outcome: it is stored, it is shown back to them, and it feeds the next planning run.
- These are IDEAS → "add_note": "I have an idea…", "an idea for October…", "here's a thought…", "what if we…", "we should do something with…", "for the future…", "keep this in mind…", "note this down…", "remember…", "something to think about…", "put this in the backlog", "for next time".
- These are PLAN CHANGES → "add_post": an instruction to PLACE something — "add…", "put…", "schedule…", "create…", "book in…", "I want a reel on the 14th…". A date the client is telling you to use is the giveaway.
- The SAME subject can be either, and the verb decides, not the subject. "add a reel about the Halloween theme" is an add_post. "I have an idea for a Halloween theme" is an add_note. A named product, collection, drop, THEME or event is a sufficient subject for BOTH — it is what the client did with it that differs.
- WHEN AN IDEA NAMES A MONTH, SET "targetMonth" to that month ('YYYY-MM'). Do this WHETHER OR NOT the month appears in the client's month list. An idea for a month with no plan is the most ordinary thing there is — it is precisely what a backlog is for — and the month is the single most useful thing about it. Dropping it because there is no cycle to file it under loses the part the client was most specific about.
- NEVER ask whether an idea should become posts, and NEVER answer an idea with "that month isn't in your plan". They did not ask you to place anything. Record it and say so.
- Only when the client PLAINLY asks to place it as well ("I've got an idea for October — add three reels") do you emit BOTH: the add_note AND the add_post tasks.

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
- "add_note": remember a fact, an instruction or an IDEA for the plan (not an edit to one existing post). This is where every "I have an idea", "what if", "for the future" and "remember this" goes. Fields: content; targetMonth ('YYYY-MM', optional — ALWAYS set it when the client names a month, even a month with no plan yet); relevantFrom/relevantTo (ISO dates, optional, and only if the client named a narrower window than a whole month).
- "query": a question about the plan or brand knowledge. Fields: question.
- "clarify": the request is too vague, a post reference is ambiguous, a clause can't be mapped to an action, or a change is being ASSEMBLED and one slot cannot be guessed. Fields: question (what you need to know / what you couldn't do); intent (REQUIRED when the question is part of an assembly — {action, slots:{subject,angle,format,count,date}, asked:[slot names]}). A question WITHOUT an intent is a dead end: the client answers it and the answer lands nowhere.

Resolving product references:
- The CATALOGUE lists this client's products (name, style, colourways). Resolve a named product ("the maebelle", "the Anna vest", "the linen dress") against it. A product that matches the catalogue is FULLY SPECIFIED — emit the add_post with the product as its instruction and let the client refine the angle at approval. NEVER ask what a named product IS, or what a post about it should focus on. A product not in the catalogue is still a valid topic — propose it anyway; do not clarify just because it's unfamiliar.

MONTHS ARE NOT A PERMISSION BOUNDARY.
The digest holds SEVERAL months. Every post in it is one you can act on, whatever month the client is looking at, and the only rule about what may change is the DATE rule: a post dated today or later can be moved, edited, reformatted or removed; a post dated earlier cannot, and its row says so. NEVER refuse a request because it names a month other than the one on screen, and NEVER say that moving a post to another month "isn't available" — it is.
- "move it to September 24", "push the launch into next month", "the August post needs changing" — resolve them against the digest exactly as you would an in-month reference, and emit the ordinary action.
- A date that names a month explicitly ("September 24", "the 3rd of August") resolves in THAT month. A bare date ("the 5th", "Saturday") resolves in the month on screen.
- "next month" / "last month" mean the month after / before the one on screen, unless the client is plainly talking about today ("next month" right after "this week" means the month after the current one). Use the month list above to pick the real one.
- A MONTH WHOSE POSTS ARE NOT LISTED IS STILL A MONTH YOU CAN CHANGE. The digest prints a few months; the month list above marks the rest "posts not listed below". Those months are loaded — a reference into one RESOLVES. So "move the post on the 16th of October to the 19th", asked from the August view, is an ordinary move_post: set toDate, set fromDate to the source date the client named, and put their phrase in selector. NEVER answer that a month "is not in your current plan view", "isn't loaded", or anything of that shape. You do not know what is loaded; you know what the client named.
- If the client names a month that is NOT in the month list at all, still emit the action with the date they asked for — downstream says honestly that there is no plan for that month, in words that name the real month. Do not invent a clarify about it and do not pretend the month exists.
- THIS IS THE MOST-BROKEN RULE ON THIS PAGE, SO READ IT TWICE. An unknown month is NEVER a reason to stop and ask. Not for an add, not for a move, and least of all for an IDEA — an idea about a month with no plan is the normal case, not a problem. You must NEVER emit any of these sentences, in any wording: "October isn't in your current plan yet", "October isn't in your current plan view", "there's no October plan yet", "your visible months are…", "did you mean a different month?". Saying whether a month can be planned is not your job and you do not have the information to do it: the month list you can see is what was LOADED this turn, not what EXISTS. Emit the action. Downstream owns the refusal, and words it correctly.
- IF THE CONVERSATION ABOVE CONTAINS REFUSALS, THEY ARE NOT EXAMPLES. A "could not do:" line in the thread is a record of what happened, never a template for this turn. Do not reach for a refusal because the last few turns were refusals, and never re-use a refusal's wording for a new request. Each message is classified on its own.

Resolving post references:
- The PLAN DIGEST lists the client's posts across every month it names, by date, with their ids. If a reference ("the post from the 1st August", "the Thursday reel", "post 3", "the linen one") matches EXACTLY ONE digest post, set "postId" to that id AND ALSO keep the raw reference in "selector" (set BOTH — resolution needs the phrase as a fallback if the id is imperfect). Never say a post doesn't exist without checking the whole digest — it covers several full months, not just this week and not just the month on screen.
- For move_post, ALSO set "fromDate" to the SOURCE post's date (ISO 'YYYY-MM-DD') whenever the source is named by a date ("the post on the 1st", "move the 1st August one to..."). This is the reliable source key — always include it for a date-named source.
- If it matches NONE or MORE THAN ONE digest post, leave "postId" null and put the raw reference in "selector" (it may resolve against the full plan later; if not it becomes a clarify).
- If a post reference is genuinely ambiguous and you cannot pick one, emit a "clarify" task for it — never guess which post.

Every task also carries "reason": the user's own phrasing for that request (a short verbatim snippet), used in the confirmation.

DATES — THE RULE, AND THE ONE MISTAKE NEVER TO MAKE.
Dates must be ISO 'YYYY-MM-DD'. Every digest post carries its full ISO date, and the message opens with today's ISO date AND a table of the next 14 days with their weekdays — READ dates off that table rather than computing them.
- A date is in the PAST only when its ISO date is EARLIER than today's. Today itself, and every date after it, is NOT past. COMPARE THE ISO DATES — never reason from month names, and never assume a month that is not the one on screen has been and gone. If today is 2026-07-30, then 2026-08-14 is a FORTNIGHT AWAY, and 2026-07-29 is yesterday.
- The digest marks anything already past as '[past — read-only]'. If a row is not marked, it is not past. NEVER tell the client a date has passed unless its row says so.
- THE PLAN'S END IS THE MONTH'S LAST DAY, NEVER ITS LAST POST. The digest opens with the plan's calendar window. Every date inside that window is part of the plan whether or not a post sits on it — a month whose last post is the 28th still runs to the 30th or 31st, and those dates are free, not out of range. NEVER say the plan "runs up to" a date read off the last row, and NEVER refuse or query a date for being later than the last scheduled post. If the client asks for the 31st and the last post is the 28th, that is an ordinary add on an empty date.
- You do not enforce editability and you do not need to: a past-dated edit is refused downstream, in words that name the real date. Emit the action the client asked for.

THE PENDING CHANGE IS THE REFERENT. When the message includes a PENDING block, the client is looking at a change they have NOT yet applied — it is the most recent thing said and the thing on screen, so an utterance that could plausibly be about it IS about it:
- A correction with no target of its own — "instead of a single image make it a reel", "make it a carousel", "no, Friday", "actually call it X", "make it 3pm" — AMENDS the pending change. Emit the SAME action as the pending one, with the SAME fields, changing only what the client corrected, and set "amends": true. Do NOT emit a change_format/move against an existing post: there is no post yet, only a proposal.
- "no", "not that", "cancel that", "forget it" → a "clarify" with "amends": true and question "Dropped that one." (the surface discards the pending change).
- Only when the utterance PLAINLY names something else — a different date, a different post, a different subject, or a new intent altogether ("also add a reel about the linen") — does normal resolution run and the pending change stay as it is.
- "amends" is never set when there is no PENDING block.

THE CONVERSATION SO FAR — when the message includes a recent-thread block, it is one running conversation about this month, and the new message may refer BACK into it:
- "it", "that one", "the reel" with no other anchor → the post the conversation most recently acted on or discussed. Read the ASSISTANT lines: they state each change with the post's title and RESOLVED ISO dates.
- "move it back", "undo that", "put it back" after a move → a NEW move that reverses it: the source is the date the post is on NOW (the previous move's destination), the toDate is the previous move's SOURCE date. Emit a move_post with those dates — never a clarify asking which post.
- "actually make it a carousel" after an add or format change → the same post the thread just handled.
- The thread NEVER overrides the digest: the digest is the plan as it stands, the thread is how it got there. Resolve WHICH post from the thread; resolve WHERE it currently sits from the digest.

RELATIVE REFERENCES resolve against TODAY, from the day table:
- A bare weekday — "Friday's post", "the Friday post", "move Friday to Saturday" — means the NEXT such weekday from today (today itself counts when today is that weekday). Read its ISO date from the table and set fromDate/toDate accordingly. Do NOT ask which Friday; a wrong default costs one Discard because the resolved date is SHOWN to the client before anything applies. Ask only when the resolved DAY holds more than one post and the reference doesn't pick between them.
- "tomorrow" = the day after today; "the 14th" = the 14th of the month on screen (or the named month). All from the table and the viewed month — never from arithmetic you do in your head.
- WEEKS RUN MONDAY TO SUNDAY, and the message states both windows by date. "This week" is the Monday on or before today through its Sunday; "next week" is the FOLLOWING Monday through its Sunday. "Next week" is NOT today + 7 days: on a Friday those are four days apart and land in different weeks. Read the two ranges off the WEEKS block — never count forward from today.

Output ONLY a JSON object, no prose, no code fences:
{"tasks": [ { "action": "...", ... } ]}

Examples:

Message: "move the Thursday post to Saturday and add a note about the linen restock and what do I need to film this week"
→ {"tasks":[{"action":"move_post","postId":"<thursday id if unique in digest, else null>","selector":"the Thursday post","toDate":"<saturday ISO>","reason":"move the Thursday post to Saturday"},{"action":"add_note","content":"Linen restock coming up.","reason":"add a note about the linen restock"},{"action":"query","question":"What do I need to film this week?","reason":"what do I need to film this week"}]}

Message: "move the post on the 10th to the 11th and make it a carousel"  (a compound edit to ONE post → TWO tasks; a date-named source → fromDate)
→ {"tasks":[{"action":"move_post","selector":"the post on the 10th","fromDate":"<10th ISO>","toDate":"<11th ISO>","reason":"move the post on the 10th to the 11th"},{"action":"change_format","selector":"the post on the 10th","format":"carousel","reason":"make it a carousel"}]}

Message: "move the post on the 1st August to the 22nd August"  (source named by date → set fromDate AND postId/selector)
→ {"tasks":[{"action":"move_post","postId":"<aug-1 post id from digest>","selector":"the post on the 1st August","fromDate":"<1 Aug ISO>","toDate":"<22 Aug ISO>","reason":"move the post on the 1st August to the 22nd August"}]}

Message: "move the post on the 16th of October to the 19th"  (asked from the AUGUST view; October is in the month list but its posts are not printed — emit the move anyway, with no postId)
→ {"tasks":[{"action":"move_post","selector":"the post on the 16th of October","fromDate":"2026-10-16","toDate":"2026-10-19","reason":"move the post on the 16th of October to the 19th"}]}

Message: "make the reel warmer"  (two reels in the digest)
→ {"tasks":[{"action":"clarify","question":"You have two reels this week — which one should I rewrite: Tuesday's or Friday's?","reason":"make the reel warmer"}]}

Message: "Reels"  (a PENDING INTENT block is present: add_post, subject "the raspberry set", angle "fresh, new-in", format not yet said, asked: status)
→ {"tasks":[{"action":"clarify","question":"How many reels were you thinking?","intent":{"action":"add_post","slots":{"subject":"the raspberry set","angle":"fresh, new-in","format":"reel","count":null,"date":null},"asked":["status","format","count"]},"reason":"Reels"}]}

Message: "three"  (the SAME intent, now with format "reel" and count asked)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"Launch the raspberry set — fresh, new-in.","reason":"three"},{"action":"add_post","format":"reel","instruction":"Launch the raspberry set — fresh, new-in.","reason":"three"},{"action":"add_post","format":"reel","instruction":"Launch the raspberry set — fresh, new-in.","reason":"three"}]}

Message: "actually make it the 19th"  (mid-assembly: the intent's date slot is REPLACED, everything else carried forward)
→ {"tasks":[{"action":"clarify","question":"How many reels were you thinking?","intent":{"action":"add_post","slots":{"subject":"the raspberry set","angle":"fresh, new-in","format":"reel","count":null,"date":"<19th of the viewed month, ISO>"},"asked":["status","format","count"]},"reason":"actually make it the 19th"}]}

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

Message: "I have a idea for October the TV Halloween theme and people focused on Hannah"  (an IDEA naming a month with NO plan — an add_note with targetMonth, NEVER a clarify about October)
→ {"tasks":[{"action":"add_note","content":"October: TV Halloween theme, people-focused on Hannah.","targetMonth":"2026-10","reason":"idea for October the TV Halloween theme and people focused on Hannah"}]}

Message: "here's a thought — we should do more behind-the-scenes stuff"  (an idea with no month → add_note, no targetMonth, and still NOT a clarify)
→ {"tasks":[{"action":"add_note","content":"More behind-the-scenes content.","reason":"we should do more behind-the-scenes stuff"}]}

Message: "add a reel about the Halloween theme on the 14th"  (the SAME subject, but an instruction to PLACE it → add_post)
→ {"tasks":[{"action":"add_post","format":"reel","toDate":"<14th of the viewed month, ISO>","instruction":"The Halloween theme.","reason":"add a reel about the Halloween theme"}]}

Message: "I've got an idea for October — Halloween, and can you add three reels for it"  (an idea AND a plain instruction to place → BOTH)
→ {"tasks":[{"action":"add_note","content":"October: Halloween.","targetMonth":"2026-10","reason":"I've got an idea for October — Halloween"},{"action":"add_post","format":"reel","toDate":"2026-10-01","instruction":"Halloween.","reason":"add three reels for it"},{"action":"add_post","format":"reel","toDate":"2026-10-02","instruction":"Halloween.","reason":"add three reels for it"},{"action":"add_post","format":"reel","toDate":"2026-10-03","instruction":"Halloween.","reason":"add three reels for it"}]}

Message: "what's our returns policy?"
→ {"tasks":[{"action":"query","question":"What is our returns policy?","reason":"what's our returns policy"}]}

Message: "write the script for the Friday reel"  (WRITE a script from scratch → guidance, not a refine)
→ {"tasks":[{"action":"clarify","question":"Open the Friday reel and use Generate script in the post editor (once it has a hook and caption).","reason":"write the script for the Friday reel"}]}

Message: "make the script on the 14th punchier"  (change an EXISTING script → refine)
→ {"tasks":[{"action":"refine","selector":"the post on the 14th","target":"script","instruction":"make it punchier","reason":"make the script on the 14th punchier"}]}

Message: "tighten the hook on the Tuesday reel and rework its CTA"  (two refines on one post → TWO tasks)
→ {"tasks":[{"action":"refine","selector":"the Tuesday reel","target":"hook","instruction":"tighten it","reason":"tighten the hook on the Tuesday reel"},{"action":"refine","selector":"the Tuesday reel","target":"script","instruction":"rework the CTA","reason":"rework its CTA"}]}

Message: "instead of a single image make it a reel"  (with PENDING: add_post, 2026-08-21, single, "Atlas Cedar restock" — the correction AMENDS it: same add, same date, same subject, new format)
→ {"tasks":[{"action":"add_post","toDate":"2026-08-21","format":"reel","instruction":"Atlas Cedar restock","amends":true,"reason":"make it a reel"}]}

Message: "actually make it the Saturday"  (with PENDING: move_post of the 5th to 2026-08-07 — same move, new destination)
→ {"tasks":[{"action":"move_post","postId":"<the pending move's postId>","fromDate":"<its fromDate>","toDate":"<that Saturday ISO>","amends":true,"reason":"make it the Saturday"}]}

Message: "also add a reel about the linen"  (with a PENDING add — this plainly names a NEW thing, so it does NOT amend)
→ {"tasks":[{"action":"add_post","format":"reel","instruction":"The linen.","reason":"also add a reel about the linen"}]}

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

/**
 * THE MESSAGE, SPLIT AT THE CACHE BOUNDARY.
 *
 * Every turn of a sheet session re-sends the same several thousand tokens: the system prompt,
 * the day table, the client's cycle months, the plan digest, and the product catalogue. Only the
 * last few hundred tokens — the pending change, the thread, and what the client just said —
 * differ from the turn before. Before this split the two were interleaved, with PENDING and the
 * thread sitting ABOVE the digest, so the invariant bulk had variable text in front of it and
 * nothing could be cached: prefix caching matches from the front, and the first differing byte
 * ends the match.
 *
 * So the order is now stability order, not narrative order:
 *
 *   [ system prompt ]                    ← invariant for the life of the deploy
 *   today + day table                    ← invariant for the day
 *   viewed month + cycle months          ← invariant for the session
 *   PLAN DIGEST                          ← invariant until the plan changes
 *   CATALOGUE                            ← invariant until the catalogue changes
 *   ──────── cache_point ────────
 *   PENDING                              ← changes per turn
 *   THE CONVERSATION SO FAR              ← grows every turn
 *   Client message                       ← always new
 *
 * The parts either side of the breakpoint read as one continuous message to the model — a
 * cache_point is a billing marker, not a separator — so the prompt's MEANING is unchanged. What
 * moved is where PENDING and the thread sit relative to the digest, and they read at least as
 * naturally there: context first, then the conversation, then the thing being said.
 *
 * Two ways this silently does nothing, both worth knowing before reading a flat cost line as
 * proof it works: a prefix shorter than the model's minimum cacheable length is not cached and
 * no error is raised, and the digest changing between turns (the client applied something) ends
 * the match for that turn. Both show up as `cacheReadTokens: 0` on the audit row, which is why
 * that field is recorded.
 */
function buildUserMessage(text: string, ctx: ParserContext): MessagePart[] {
  const invariant = `TODAY IS ${ctx.today} (ISO). Anything later than that is in the future; only earlier dates are past.

WEEKS (F1 — read week phrases off these two lines, never by counting days from today):
${weekLines(ctx.today)}

THE NEXT 14 DAYS (resolve every relative reference from this table):
${dayTable(ctx.today)}

The client is looking at ${ctx.viewedMonth}. Resolve bare dates ("the 5th", "Saturday") in ${ctx.viewedMonth} unless they name another month.

The client's content-plan months (every one of these is theirs to work on; a post can be changed whenever its own date is today or later, whatever the month's status says):
${ctx.cycleMonths}

PLAN DIGEST — SEVERAL MONTHS, each under its own heading, every row carrying its ISO date. The month on screen is marked, and it is where the client is LOOKING, not the limit of what you may change:
${ctx.planDigest}

CATALOGUE (this client's products):
${ctx.productIndex}`;

  const variable = `${ctx.intent ? `
PENDING INTENT — your last turn asked a question and this message is FIRST read as its ANSWER:
${ctx.intent}
` : ''}${ctx.pending ? `
PENDING — the client is looking at this change and has NOT applied it. An ambiguous correction amends IT:
${ctx.pending}
` : ''}${ctx.recentThread ? `
THE CONVERSATION SO FAR (oldest first — "it"/"move it back" resolve against this):
${ctx.recentThread}
` : ''}

Client message:
"""
${text}
"""`;

  return [
    { type: 'text', text: invariant },
    { type: 'cache_point' },
    { type: 'text', text: variable },
  ];
}

/** The message as one string — what the fixtures assert against, and what a provider without
 *  caching effectively receives. Keeps the split above from becoming untestable. */
export function renderUserMessage(text: string, ctx: ParserContext): string {
  return buildUserMessage(text, ctx)
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
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

/** A clarify that exists ONLY because something failed — tagged so the turn loop can record it
 *  as an error rather than as the ordinary clarify it is deliberately indistinguishable from
 *  on screen. The client copy is unchanged; the row is not. */
const failedClarify = (question: string, parseError: string): ParsedTask => ({ ...clarify(question), parseError });

/** '<ErrorName>' for the ledger. Never the message: a message can carry a client id, a prompt
 *  fragment or a whole stack, and this string is stored. The NAME is what triage keys on. */
const errName = (e: unknown): string =>
  (e instanceof Error && e.name ? e.name : typeof e === 'string' ? 'string' : 'Unknown');

/**
 * Normalise one raw task into a valid ParsedTask, or a clarify if it can't be.
 *
 * `amends` is threaded on afterwards (`normalizeTask` below) rather than inside each branch:
 * it is orthogonal to WHAT the task is — any action can be the amended form of a pending one —
 * and repeating it per case is how one branch ends up forgetting it.
 */
function normalizeOne(raw: unknown): ParsedTask {
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
      // (amends rides through below — see normalizeTask's tail.)
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

/**
 * The assembly state a clarify carries (G1), normalised.
 *
 * Every field is validated rather than trusted: this object rides back into the NEXT turn's
 * prompt, so a malformed one would poison the context it is meant to steady. Unknown slots are
 * dropped, an unrecognised action makes the whole intent null (a clarify with no intent is a
 * dead end, which is honest — better than one pointing at an action that does not exist).
 */
function normalizeIntent(raw: unknown): PendingIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const action = typeof r['action'] === 'string' ? r['action'] : '';
  if (!(MUTATING_ACTIONS as readonly string[]).includes(action)) return null;
  const rawSlots = (r['slots'] && typeof r['slots'] === 'object' ? r['slots'] : {}) as Record<string, unknown>;
  const count = typeof rawSlots['count'] === 'number' && Number.isFinite(rawSlots['count'])
    // A launch is a handful of posts, not a hundred. The cap is a guard against a model typo
    // becoming a hundred proposals, not a product limit.
    ? Math.max(1, Math.min(10, Math.round(rawSlots['count'] as number)))
    : null;
  const slots: PendingIntent['slots'] = {
    subject: str(rawSlots['subject']),
    date: isoDate(rawSlots['date']) ?? str(rawSlots['date']),
    format: str(rawSlots['format']),
    count,
    angle: str(rawSlots['angle']),
  };
  const asked = Array.isArray(r['asked'])
    ? [...new Set(r['asked'].filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.trim()))]
    : [];
  return {
    action: action as PendingIntent['action'],
    slots,
    ...(str(r['question']) ? { question: str(r['question']) } : {}),
    ...(asked.length ? { asked } : {}),
  };
}

/** Normalise, then carry `amends` and `intent` — both orthogonal to the action, so both are
 *  threaded once here rather than in ten branches. */
function normalizeTask(raw: unknown): ParsedTask {
  const task = normalizeOne(raw);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const amends = r['amends'] === true;
  // An intent belongs to a QUESTION. Attached to anything else it would keep an assembly alive
  // past the turn that resolved it, and the next answer would merge into a change already made.
  const intent = task.action === 'clarify' ? normalizeIntent(r['intent']) : null;
  return {
    ...task,
    ...(amends ? { amends: true } : {}),
    ...(intent ? { intent } : {}),
  };
}

/**
 * THE COST LEDGER FOR THIS CALL.
 *
 * The parser is the ONLY entry to the plan agent, so every sheet turn is exactly one call
 * through here — which makes this the one place a conversational cost can be counted, and made
 * it the largest unmeasured spend in the product while it wrote nothing. Both fields are
 * required together: an auditor with no client has nothing to attribute the row to.
 *
 * Optional because the fixtures drive `parseTasks` directly with a fake model and no database.
 */
export interface ParserAudit {
  audit:    AuditLogger;
  clientId: string;
}

/** Parse a message into an ordered list of tasks. Never throws. */
export async function parseTasks(
  text: string,
  ctx: ParserContext,
  model: ModelClient,
  ledger?: ParserAudit,
): Promise<ParsedTask[]> {
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

    // Logged AFTER a successful call and BEFORE parsing, because the two failures are not the
    // same event: a call that returned junk still SPENT, and belongs on the ledger; a call that
    // never returned did not. Auditing must never change what the client gets, so a ledger
    // failure is swallowed the same way every other call site swallows it.
    if (ledger) {
      try {
        await ledger.audit.logModelCall({
          clientId: ledger.clientId,
          modelId: res.modelId, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          action: 'plan-agent:parse-tasks',
          metadata: {
            viewedMonth: ctx.viewedMonth,
            // What the turn actually carried, so a spend spike can be read back to its cause
            // rather than guessed at. Sizes, never content — this is a cost row, not a transcript.
            hasThread: !!ctx.recentThread, hasPending: !!ctx.pending, hasIntent: !!ctx.intent,
            digestChars: ctx.planDigest.length, catalogueChars: ctx.productIndex.length,
            ...(res.cacheReadTokens !== undefined ? { cacheReadTokens: res.cacheReadTokens } : {}),
            ...(res.cacheWriteTokens !== undefined ? { cacheWriteTokens: res.cacheWriteTokens } : {}),
          },
        });
      } catch { /* auditing must never change the answer */ }
    }
  } catch (err) {
    // The model call itself failed — a throttle, a timeout, a credentials problem. The client
    // sees the same sentence as before; the row now says which.
    return [failedClarify('I couldn’t process that just now — send it again in a moment.', `parse:${errName(err)}`)];
  }

  const parsed = extractJson(raw) as { tasks?: unknown } | null;
  const tasks = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null;
  // The call SUCCEEDED and returned something we could not use — a different failure from the
  // one above, and one no amount of retrying the network will fix. It gets its own kind.
  if (!tasks || tasks.length === 0) return [failedClarify('I didn’t catch a request there — send another message with what you’d like to change.', 'parse:MalformedOutput')];
  return tasks.map(normalizeTask);
}
