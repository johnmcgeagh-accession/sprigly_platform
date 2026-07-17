-- 0082_prod_data_seed — replay the DATA seeded by migrations 0062–0080 into prod.
--
-- Prod already has all SCHEMA (0081 applied the 13 tables, 11 columns, function,
-- triggers). This file carries ONLY data — every DDL statement from the source
-- migrations is stripped. Source files replayed, in numeric order:
--   0067_step_templates      — step_templates (3 rows)
--   0070_hooks_scripts       — hook_patterns (42 rows)
--   0071_generation_prompts  — prompt_templates GLOBAL: plan_hooks/generate, plan_scripts/generate
--   0072_ivy_t_generation_prompts — prompt_templates ivy-t: plan_hooks/generate, plan_scripts/generate
--   0073_refine_prompts      — prompt_templates GLOBAL: plan_hooks/refine, plan_scripts/refine
--   0075_generate_plan_deivyt — ivy-t planning/generate-plan (copy of GLOBAL v4) + GLOBAL v5
--   0077_email_templates     — email_templates v1: ask, nudge, last_call, plan_ready
--   0078_ask_template_v2     — email_templates ask v2 + republish flip
--   0079_themes              — themes (2 rows)
--
-- DDL-only sources with no data (skipped): 0062, 0063, 0064, 0065, 0066, 0068,
-- 0069, 0074, 0076, 0080. (0064's "UPDATE clients" is a comment, not a statement.)
--
-- Single transaction: 0071's GLOBAL rows are visible to 0072's provenance SELECT
-- (read-your-writes); 0075 Step 1 copies the current GLOBAL generate-plan v4 body
-- into ivy-t's override BEFORE Step 2 inserts GLOBAL v5. The resolver
-- (packages/prompts/src/index.ts) is scope-first, version-second with no cache, so
-- GLOBAL generate-plan v5 must never commit without ivy-t's generate-plan override
-- present in the SAME commit — this file guarantees that.
--
-- Client scope: ivy-t rows are seeded by slug lookup (WHERE c.slug = 'ivy-t').
-- Nothing seeds earl-of-east (d5ea71c4-...); prod has only ivy-t + sprigly anyway.
-- Not seeded (stay empty): agent_messages, agent_proposals, conversations,
-- plan_activity, plan_inputs, post_steps, ui_events, weekly_sessions, ig_posts.
--
-- Every statement is idempotent (ON CONFLICT / WHERE NOT EXISTS); guards were ADDED
-- to the 0077/0078/0079 inserts without changing any value. All prompt/template
-- text is copied verbatim from the source files.
--
-- Apply with:  psql "<DATABASE_URL>" -f 0082_prod_data_seed.sql

BEGIN;

-- ── HARD PRECONDITION ─────────────────────────────────────────────────────────
-- 0075 Step 1 copies the CURRENT max-version GLOBAL planning/generate-plan body
-- into ivy-t's override. That must be v4. A different max would silently produce
-- the wrong override with no error, so fail loudly here instead.
DO $$
DECLARE
  v integer;
BEGIN
  SELECT max(version) INTO v
  FROM "prompt_templates"
  WHERE client_id IS NULL AND workflow_id = 'planning' AND step_name = 'generate-plan';
  IF v IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondition failed: GLOBAL planning/generate-plan max version is %, expected 4 (0075 Step 1 must copy the v4 body). Aborting.', v;
  END IF;
END $$;

-- ── 0067_step_templates — step_templates (idempotent: ON CONFLICT) ────────────
INSERT INTO "step_templates" ("content_type", "steps") VALUES
  ('reel',     '[{"label":"Script & hook","leadDays":4},{"label":"Shoot","leadDays":3},{"label":"Edit","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb),
  ('carousel', '[{"label":"Source shots","leadDays":3},{"label":"Design frames","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb),
  ('single',   '[{"label":"Source image","leadDays":2},{"label":"Caption","leadDays":1}]'::jsonb)
ON CONFLICT ("content_type") DO NOTHING;

-- ── 0070_hooks_scripts — hook_patterns 42 rows (idempotent: WHERE NOT EXISTS) ──
INSERT INTO "hook_patterns" ("name", "category", "pattern", "example", "formats")
SELECT * FROM (VALUES
  ('Curiosity gap', 'curiosity', 'The real reason {surprising outcome} — and it isn''t {assumed cause}.', 'The real reason this sold out twice — and it isn''t the fabric.', ARRAY['reel','carousel']::text[]),
  ('Withheld reveal', 'curiosity', 'We almost didn''t {action}. Here''s what changed our mind.', 'We almost didn''t make this in green. Here''s what changed our mind.', ARRAY['reel','carousel']::text[]),
  ('Unexpected pairing', 'curiosity', 'What {familiar thing} taught us about {your domain}.', 'What sourdough taught us about cutting linen.', ARRAY['reel','carousel']::text[]),
  ('Open loop', 'curiosity', 'There''s one thing we never show on this account. Today we are.', 'There''s one part of the studio we never film. Today we are.', ARRAY['reel']::text[]),
  ('Anomaly flag', 'curiosity', 'Something odd happens every time we {routine action}.', 'Something odd happens every time we restock the poplin shirt.', ARRAY['reel','carousel']::text[]),
  ('Behind the number', 'curiosity', '{Specific number} {units}. Here''s the story behind that number.', 'Forty-one metres of deadstock. Here''s the story behind that number.', ARRAY['reel','carousel']::text[]),
  ('Myth-bust', 'contrarian', 'Everyone says {common advice}. We do the opposite — here''s why.', 'Everyone says post daily. We post nine times a month — here''s why.', ARRAY['reel','carousel']::text[]),
  ('Unpopular opinion', 'contrarian', 'Unpopular opinion: {position that challenges category norms}.', 'Unpopular opinion: most ''sustainable'' fabric claims don''t survive a second question.', ARRAY['reel','carousel']::text[]),
  ('Stop doing X', 'contrarian', 'Stop {common practice}. Do {alternative} instead.', 'Stop washing linen like cotton. Do this instead.', ARRAY['reel','carousel']::text[]),
  ('Sacred cow', 'contrarian', '{Beloved industry norm} is overrated. There, we said it.', 'Seasonal drops are overrated. There, we said it.', ARRAY['reel']::text[]),
  ('Quiet disagreement', 'contrarian', 'We were told {advice} when we started. Ignoring it was the best call we made.', 'We were told to chase trends when we started. Ignoring it was the best call we made.', ARRAY['reel','carousel']::text[]),
  ('Direct-address question', 'question', 'Have you ever {relatable moment in customer''s life}?', 'Have you ever bought something twice because the first one never left the wash basket?', ARRAY['reel','carousel']::text[]),
  ('Which-one poll', 'question', '{Option A} or {option B}? Be honest.', 'Ochre or ivy green? Be honest.', ARRAY['reel','carousel']::text[]),
  ('Guess-the-answer', 'question', 'Can you guess {quantifiable fact about process/product}?', 'Can you guess how many pattern pieces are in one shirt?', ARRAY['reel']::text[]),
  ('Self-audit question', 'question', 'When did you last {small behaviour tied to your value prop}?', 'When did you last repaired something instead of replacing it?', ARRAY['reel','carousel']::text[]),
  ('Numbered promise', 'promise', '{N} {things} that {benefit} — number {k} is the one nobody does.', 'Five ways to style one shirt for a week — number four is the one nobody does.', ARRAY['carousel','reel']::text[]),
  ('Time-boxed payoff', 'promise', 'In the next {seconds}, you''ll know exactly how to {outcome}.', 'In the next thirty seconds, you''ll know exactly how to spot a well-made seam.', ARRAY['reel']::text[]),
  ('Complete guide', 'promise', 'Everything you need to know about {topic}, in one post. Save it.', 'Everything you need to know about caring for linen, in one post. Save it.', ARRAY['carousel']::text[]),
  ('Shortcut reveal', 'promise', 'The {timeframe} version of {complex thing}.', 'The two-minute version of how a garment gets costed.', ARRAY['reel','carousel']::text[]),
  ('Do-this-get-that', 'promise', 'Do {one small thing} and {specific improvement} follows.', 'Change one washing habit and your knits last twice as long.', ARRAY['reel','carousel']::text[]),
  ('Relatable pain', 'pain', 'You know that feeling when {specific frustration}? Let''s fix it.', 'You know that feeling when a new top bobbles after two wears? Let''s fix it.', ARRAY['reel','carousel']::text[]),
  ('Silent struggle', 'pain', 'Nobody talks about {hidden difficulty}. So we will.', 'Nobody talks about how hard sizing is for small brands. So we will.', ARRAY['reel','carousel']::text[]),
  ('Cost of inaction', 'pain', '{Avoided task} is costing you more than you think.', 'That drawer of ''almost right'' basics is costing you more than you think.', ARRAY['carousel']::text[]),
  ('Mistake confession', 'pain', 'We got {thing} badly wrong. Here''s what it taught us.', 'We got our first production run badly wrong. Here''s what it taught us.', ARRAY['reel','carousel']::text[]),
  ('Receipts open', 'proof', '{Specific result, plainly stated}. Here''s exactly how.', 'Sold out in nineteen hours. Here''s exactly how.', ARRAY['reel','carousel']::text[]),
  ('Before/after', 'proof', '{Starting state} → {end state}. The middle is the interesting bit.', 'Flat sketch → finished garment. The middle is the interesting bit.', ARRAY['reel','carousel']::text[]),
  ('Third-party voice', 'proof', 'A customer said {short paraphrased sentiment}. We want to unpack that.', 'A customer said this shirt ''ended her Sunday ironing''. We want to unpack that.', ARRAY['reel','carousel']::text[]),
  ('Live test', 'proof', 'We put {claim} to the test on camera.', 'We put the ''no-crease'' claim to the test on camera.', ARRAY['reel']::text[]),
  ('In-media-res', 'story', '{Drop straight into mid-scene, present tense}.', 'The boxes arrive at 7am and the whole plan changes.', ARRAY['reel']::text[]),
  ('Origin fragment', 'story', '{Time marker}, {founder} {small concrete scene that started it all}.', 'Three summers ago, Sally cut up her favourite worn-out shirt to see how it was made.', ARRAY['reel','carousel']::text[]),
  ('Day-in-the-life', 'story', '{Time} on a {day}. This is what {role/process} actually looks like.', '6:40 on a Tuesday. This is what a restock morning actually looks like.', ARRAY['reel']::text[]),
  ('Turning point', 'story', 'Everything was fine until {inflection moment}.', 'Everything was fine until the fabric mill closed with our order inside.', ARRAY['reel']::text[]),
  ('POV', 'identity', 'POV: you''re {person in audience''s aspirational/relatable situation}.', 'POV: you''re the friend whose outfit everyone asks about, quietly.', ARRAY['reel']::text[]),
  ('This-is-for-you', 'identity', 'If you {specific behaviour/preference}, this one''s for you.', 'If you''d rather own five perfect things than fifty average ones, this one''s for you.', ARRAY['reel','carousel']::text[]),
  ('Us-vs-the-category', 'identity', 'We''re not a {category label} brand. Here''s what we are instead.', 'We''re not a fast-fashion brand doing slow-fashion marketing. Here''s what we are instead.', ARRAY['reel','carousel']::text[]),
  ('Insider reveal', 'identity', 'Things {insiders} know that {outsiders} don''t.', 'Things pattern cutters know that shoppers don''t.', ARRAY['carousel','reel']::text[]),
  ('Quiet scarcity', 'urgency', '{Small batch fact}, and when it''s gone it''s gone — here''s why we won''t remake it.', 'Sixty pieces, and when they''re gone they''re gone — here''s why we won''t remake them.', ARRAY['reel','carousel']::text[]),
  ('Window closing', 'urgency', 'You''ve got {timeframe} before {change}. Use it well.', 'You''ve got one week before the price of this fabric changes everything. Use it well.', ARRAY['reel']::text[]),
  ('Watch-me-do-it', 'instructional', 'Watch us {process} from start to finish — no cuts.', 'Watch us press and finish one shirt from start to finish — no cuts.', ARRAY['reel']::text[]),
  ('Common-mistake fix', 'instructional', 'You''re probably {doing task} wrong. Two changes fix it.', 'You''re probably storing knitwear wrong. Two changes fix it.', ARRAY['reel','carousel']::text[]),
  ('Checklist open', 'instructional', 'Before you {common action}, check these {N} things.', 'Before you buy ''organic cotton'', check these three things.', ARRAY['carousel']::text[]),
  ('One-thing rule', 'instructional', 'If you only remember one thing about {topic}, make it this.', 'If you only remember one thing about fit, make it this.', ARRAY['reel','carousel']::text[])
) AS seed("name", "category", "pattern", "example", "formats")
WHERE NOT EXISTS (SELECT 1 FROM "hook_patterns");

-- ── 0071_generation_prompts — GLOBAL plan_hooks/generate, plan_scripts/generate ──
INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_hooks', 'generate', $prompt$You write scroll-stopping social hooks for a founder-led brand.

You are given the client's voice (voice.md), a post's format/pillar/caption, and a set of
HOOK PATTERNS, each expressed as a STRUCTURE with {slot} placeholders plus one illustrative
example from a different brand.

Rules:
- Imitate the STRUCTURE of a pattern. NEVER reuse the example's content — the examples are
  illustrations only; copying their words is a failure.
- Fill the structure with THIS post's specifics (from the caption/pillar), written in the
  client's voice and register from voice.md.
- One line per hook. Plain language. No hashtags. No emoji unless the client's voice uses them.
- Ground every claim in the caption — invent nothing about the product, fabric, or numbers.
- Return EXACTLY this JSON and nothing else: {"hooks": ["…", "…", "…"]}$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_hooks' AND "step_name" = 'generate' AND "version" = 1
);

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_scripts', 'generate', $prompt$You write short-form video scripts (reels) for a founder-led brand.

You are given the client's voice (voice.md), a post's pillar/caption, the chosen HOOK, and a
TARGET LENGTH in seconds with a words-per-second budget (speak ~2.2 words/second).

Produce a tight, shootable script for that length:
- Open on the given HOOK verbatim as the first spoken line.
- 2–4 BEATS, each a single spoken sentence plus a brief shot/visual suggestion in parentheses,
  timed to fit the target length.
- End with a clear CTA in the client's voice.
- Ground everything in the caption and voice.md; invent no product facts.
- Return plain text in this shape (no JSON, no preamble):
  HOOK: <the hook>
  BEAT 1 (0–Xs) — <line> (<shot>)
  BEAT 2 … 
  CTA: <line>$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_scripts' AND "step_name" = 'generate' AND "version" = 1
);

-- ── 0072_ivy_t_generation_prompts — ivy-t hook + script (provenance derives from 0071) ──
INSERT INTO "prompt_templates"
  ("client_id", "workflow_id", "step_name", "prompt_text", "version", "copied_from_template_id", "copied_from_version")
SELECT
  c.id,
  'plan_hooks',
  'generate',
  $prompt$You write scroll-stopping Instagram hooks for IVY-t ("Ivy") — a founder-led, organic-cotton womenswear brand. The founder, Sally, writes as herself: a real woman who wants to make getting dressed easier. Every hook must sound like Sally, never like an ad.

You are given Ivy's voice (voice.md), a post's format/pillar/caption, and a set of HOOK PATTERNS — each a STRUCTURE with {slot} placeholders plus one illustrative example from a DIFFERENT brand.

How to write:
- Imitate the STRUCTURE of a pattern. NEVER reuse the example's words — the examples are illustrations only; copying them is a failure.
- Fill the structure with THIS post's specifics (from the caption/pillar), in Ivy's register from voice.md.
- One line per hook. Short and punchy — a single sentence is ideal. Plain, warm, everyday language.
- Ground every claim in the caption. Invent nothing about the product, fabric, fit, or numbers — if the caption does not say it, do not imply it.

IVY HOUSE RULES (voice.md is the fuller source; these always apply):
- Warm, principled, unfussy, genuine. Friendly and confident, never showy, hype-y or salesy. Litmus test: friendly, confident and easy to understand -> it's Ivy; showy, complicated or trying too hard -> it's not.
- NO em dashes. Use commas, short sentences or a full stop for rhythm. (The only hyphen Ivy uses is the "Item - Brand" credit format, which never appears in a hook.)
- No hard sell ("buy now", "limited time", "don't miss out"), no vague superlatives ("exceptional quality", "elevated"), no trend-chasing ("must-have", "on trend"), no corporate warmth ("committed to", "passionate about").
- Avoid AI tells: the rule of three ("clarity, comfort and confidence"), present-participle tails ("...ensuring every woman feels her best"), and filler intensifiers ("genuinely", "really", "truly").
- Sustainability is embedded, never announced — do not lead with "eco" or "sustainable". If fabric matters, name it plainly: "organic cotton" (always in full, never just "cotton"), "GOTS certified", "natural fibres".
- Reach for Ivy's own words when they fit: effortless, timeless, staples, "reach for again and again", comfortable and flattering, overwhelm / decision fatigue (for getting-dressed posts), intentional, simple. Garments are women's names (Connie, Maggie, Emma, Hannah…) and are "she/her" — write them with genuine fondness, and state the colourway on first mention.
- Never leave a claim unexplained — if a hook makes a promise, its reason must be honest and groundable in the caption.
- No hashtags. No emoji unless Ivy's voice clearly uses them (the white heart is her signature); keep any emoji purposeful, never mid-sentence.

Return EXACTLY this JSON and nothing else: {"hooks": ["…", "…", "…"]}$prompt$,
  1,
  g.id,
  g.version
FROM clients c
LEFT JOIN LATERAL (
  SELECT id, version FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_hooks' AND "step_name" = 'generate'
  ORDER BY version DESC LIMIT 1
) g ON true
WHERE c.slug = 'ivy-t'
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates" t
    WHERE t."client_id" = c.id AND t."workflow_id" = 'plan_hooks' AND t."step_name" = 'generate' AND t."version" = 1
  );

INSERT INTO "prompt_templates"
  ("client_id", "workflow_id", "step_name", "prompt_text", "version", "copied_from_template_id", "copied_from_version")
SELECT
  c.id,
  'plan_scripts',
  'generate',
  $prompt$You write short-form video scripts (reels) for IVY-t ("Ivy") — a founder-led, organic-cotton womenswear brand. The founder, Sally, is usually the face of the reel; write spoken lines that sound like her: warm, principled, unfussy, genuine.

You are given Ivy's voice (voice.md), a post's pillar/caption, the chosen HOOK, and a TARGET LENGTH in seconds with a words-per-second budget (speak ~2.2 words/second).

Produce a tight, shootable script for that length:
- Open on the given HOOK verbatim as the first spoken line.
- 2–4 BEATS, each a single spoken sentence plus a brief shot/visual suggestion in parentheses, timed to fit the target length.
- Close with a CTA in Ivy's voice — soft, community-first and always warm. Prefer Ivy's real mechanics: "comment '[Name]' to join the waitlist", "our DMs are always open and we love hearing from you", "get in touch by DM if you have any sizing or fit questions". Never a flat "shop now".
- Ground everything in the caption and voice.md. Invent no product facts. Never leave a claim unexplained — tie any promise to its honest reason.

IVY HOUSE RULES (voice.md is the fuller source; these always apply):
- Warm, confident, easy to understand, never showy or salesy. Short spoken sentences. Litmus test: friendly, confident and easy -> it's Ivy; showy or trying too hard -> it's not.
- Register by post type — pick ONE and hold it through the whole script, never mixing "I" and "we": founder notes, origin stories, Weekend Style Guide and Ours-vs-Theirs are Sally's first person ("I"); product launches, Sunday Style, styling, educational and sustainability posts are brand "we".
- NO em dashes in spoken lines; use commas, short sentences or full stops. No hard sell, no vague superlatives ("exceptional", "elevated"), no trend-chasing, no corporate warmth ("committed to", "passionate about"). Avoid AI tells: the rule of three, present-participle tails ("...ensuring..."), and filler intensifiers ("genuinely", "really", "truly").
- Sustainability is embedded, not announced — weave in "organic cotton" (always in full), "GOTS certified", "natural fibres" only where the caption warrants it. Garments are women's names and "she/her"; state the colourway on first mention. Technical accuracy matters: jersey is knitted, not woven.
- No hashtags. Emoji only if Ivy's voice uses them (the white heart is her signature); keep them purposeful.

Return plain text in this shape (no JSON, no preamble):
  HOOK: <the hook>
  BEAT 1 (0–Xs) — <line> (<shot>)
  BEAT 2 …
  CTA: <line>$prompt$,
  1,
  g.id,
  g.version
FROM clients c
LEFT JOIN LATERAL (
  SELECT id, version FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_scripts' AND "step_name" = 'generate'
  ORDER BY version DESC LIMIT 1
) g ON true
WHERE c.slug = 'ivy-t'
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates" t
    WHERE t."client_id" = c.id AND t."workflow_id" = 'plan_scripts' AND t."step_name" = 'generate' AND t."version" = 1
  );

-- ── 0073_refine_prompts — GLOBAL plan_hooks/refine, plan_scripts/refine ──────
INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_hooks', 'refine', $prompt$You refine a single Instagram HOOK (for a reel or carousel) to a client instruction, with the LIGHTEST touch that satisfies it.

You are given the client's voice (voice.md), the post's pillar/caption for context, the CURRENT HOOK, and an INSTRUCTION (e.g. "make it punchier", "shorter", "rework the opening", "warmer").

Rules:
- Make the MINIMAL change that satisfies the instruction. Preserve everything the instruction did NOT ask to change — the same angle, the same specifics, the same voice. Do NOT rewrite from scratch.
- It must stay a HOOK: ONE line, a scroll-stopping opening. Never let it grow into caption-length prose or multiple lines.
- Keep the client's voice and register from voice.md. Ground every claim in the caption; invent nothing.
- No hashtags. No emoji unless the client's voice uses them.
- Return ONLY the refined hook line as plain text. No surrounding quotes, no preamble, no JSON.$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_hooks' AND "step_name" = 'refine' AND "version" = 1
);

INSERT INTO "prompt_templates" ("client_id", "workflow_id", "step_name", "prompt_text", "version")
SELECT NULL, 'plan_scripts', 'refine', $prompt$You refine a single short-form video SCRIPT (a reel) to a client instruction, with the LIGHTEST touch that satisfies it, keeping it timed.

You are given the client's voice (voice.md), the post's pillar/caption, the HOOK, a TARGET LENGTH in seconds with a words-per-second budget (speak ~2.2 words/second), the CURRENT SCRIPT, and an INSTRUCTION (e.g. "make it punchier", "tighten the middle", "rework the CTA").

Rules:
- Make the MINIMAL change that satisfies the instruction. Preserve the beats, shots, and CTA the instruction did NOT ask to change. Do NOT rewrite from scratch.
- Keep it SHOOTABLE and TIMED: open on the HOOK verbatim as the first spoken line, keep 2–4 timed BEATS (each a single spoken sentence plus a brief shot note in parentheses), end on a CTA, and stay within the length's word budget.
- Keep the client's voice and register from voice.md. Ground everything in the caption; invent no product facts.
- Return plain text in this shape (no JSON, no preamble):
  HOOK: <the hook>
  BEAT 1 (0–Xs) — <line> (<shot>)
  BEAT 2 …
  CTA: <line>$prompt$, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates"
  WHERE "client_id" IS NULL AND "workflow_id" = 'plan_scripts' AND "step_name" = 'refine' AND "version" = 1
);

-- ── 0075_generate_plan_deivyt — Step 1: ivy-t override = copy of GLOBAL v4 ────
INSERT INTO "prompt_templates"
  ("client_id","workflow_id","step_name","prompt_text","version","copied_from_template_id","copied_from_version")
SELECT c.id, 'planning', 'generate-plan', g.prompt_text, 1, g.id, g.version
FROM "clients" c
CROSS JOIN LATERAL (
  SELECT id, prompt_text, version FROM "prompt_templates"
  WHERE client_id IS NULL AND workflow_id = 'planning' AND step_name = 'generate-plan'
  ORDER BY version DESC LIMIT 1
) g
WHERE c.slug = 'ivy-t'
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates" p
    WHERE p.client_id = c.id AND p.workflow_id = 'planning' AND p.step_name = 'generate-plan'
  );

-- 0075 Step 2: NEW GLOBAL generate-plan v5 (must follow Step 1 above) ─────────
WITH neutral AS (SELECT $genplan_v5$You are Sprigly's senior Instagram content planner. You produce a complete, fully-briefed monthly Instagram content plan for a clothing brand client, ready to be turned into the client's working calendar. Every post is briefed with a real caption in the client's voice and a specific reason it was chosen.

You will be given, in the user message:
- CLIENT, PLAN MONTH (the month you are planning FOR) and DATA MONTH (the current month the intake and data come from — you always plan the month AFTER the data month). Every date you output must fall in the PLAN MONTH.
- INTAKE: the client's planning answers for the plan month (products launching/returning, key dates, what to feature, formats they want, stories to tell) plus free notes. This is your PRIMARY signal — plan the month around it.
- PLANNING CONFIG: the client's content pillars (with taglines and key messages), posting cadence, recurring series, standard posting times, and the authoritative Category list.
- COMPETITOR DATA: deterministic competitor benchmark/scores, IF available. Often absent.
- VOICE: the client's caption voice rules (voice.md), including a sign-off table by post-type. Apply them to every caption.
- PRODUCTS: the client's REAL products and their ACTUAL colourways (when available). This is the only valid product vocabulary.

BRIEF AUTHORITY (this decides WHAT to feature and WHEN, and overrides your own product picks). The client's brief is authoritative, not advisory, and its concrete form is the STRUCTURED BRIEF in the user message. Treat the STRUCTURED BRIEF as ground truth: its BRIEFED LAUNCHES / RESTOCKS are the ONLY launches and restocks this month; its FIXED DATED BEATS give the dates you must use (do not infer, shift, or de-collide dates of your own); its UNDATED CONTENT PIECES must each appear once in the month; its PLAN WINDOW bounds every date. Where the STRUCTURED BRIEF and the free-text INTAKE ever disagree, the STRUCTURED BRIEF WINS. Build the month from these briefed items first, and treat everything else as secondary to them. The PRODUCTS (catalogue) list is real name and colourway VOCABULARY for grounding and validation only. It is NOT a menu of things to feature, and a product appearing in it is not a reason to feature it; a colourway marked [BRIEFED LAUNCH] there is a real, briefed colourway you may use for the product it sits under. A product that is NOT in the STRUCTURED BRIEF's launches, restocks or schedule may appear ONLY as clearly secondary support (a supporting piece in an outfit, or a light cross sell) and must NEVER be a hero, a launch, a return, or described as "new". Do not invent a launch, a "coming soon", an "arrives" or "goes live" moment, or any date the STRUCTURED BRIEF did not state; if a product is not in the brief as launching or returning, treat it as an already existing product and never imply otherwise. Feature only what the brief and the data actually contain, and never present anything as briefed that the client did not brief.

Work through these steps:

1. STRUCTURE THE MONTH (from the intake). Identify every product launching, returning, or recently launched; the anchor dates (holidays, school breaks, season shifts); the stories the client wants told; and the formats they asked for. Build the month's spine around these before filling gaps. Honour explicit requests (e.g. "more Reels", "founder to camera").

2. PILLAR BALANCE. If COMPETITOR DATA is present, let it inform which pillars and formats to lean into. If it is absent, balance coverage across ALL the client's pillars using their taglines and key messages — do NOT invent percentages, just ensure no pillar is ignored and the most relatable pillars are well served. Assign exactly one pillar per post, using the pillar names from the config verbatim.

3. LAUNCH CLUSTERS. For each product launch or return in the intake, build a cluster across the surrounding real dates:
   - Tease (about a week before): suspense hook, a comment/waitlist CTA.
   - Value post (day before): cost-per-wear or investment framing, a concrete reason to buy.
   - Launch post (launch day, launch time): Reel, lead with the colourway/shade as the hero.
   - Ours vs theirs (day after): Reel, founder to camera, compare honestly WITHOUT naming competitor brands.
   - Weekend feature (that Saturday's recurring guide): cross-sell the launch piece with other pieces.
   - Sunday feature (that Sunday's recurring style post): the launch piece as the anchor.

4. RECURRING SERIES. Schedule every recurring series from the config on its correct day, time, format and who-posts. Do not change their slots. Where a series is "monthly", place it once, sensibly, in the month.

5. CADENCE & TIMES. Respect the cadence (min/max posts per month, max/min per week). Aim for the middle of the range. Use the standard posting times from the config (launches at the launch time, mornings, evenings, weekend slots).

6. PER-POST BRIEF. For every post produce all of:
   - date: day-of-month plus short month, e.g. "14 May", matching the plan month.
   - day: three-letter day name (Mon/Tue/Wed/Thu/Fri/Sat/Sun) for that real date.
   - title: a short internal name, NOT the caption.
   - category: EXACTLY one value from the config's authoritative Category list. Never invent a category.
   - pillar: EXACTLY one pillar name from the config.
   - format: Reel / Carousel / Static (or a combination).
   - postingTime: a standard time label from the config.
   - whoPosts: "Sprigly" / "founder posting" / "founder only".
   - competitorInsight: a specific, data-grounded reason for this post. If COMPETITOR DATA is present, cite the actual account and the actual numbers. If it is ABSENT, write "No competitor data this cycle." followed by a short pillar/format rationale. NEVER invent competitor names, numbers, or multipliers.
   - draftCaption: the full caption in the client's voice (see CAPTION RULES and WORKED EXAMPLES). Use \n for line breaks. Write a COMPLETE caption, typically 60-110 words (more for Sunday Style and founder posts), in 2-4 developed paragraphs with specific, sensory detail. Never write a thin one or two line caption.
   - notes: practical notes for the client — what to shoot, what to confirm, what to adapt.

CAPTION RULES (apply VOICE plus these hard rules):
- NO DASHES AS PUNCTUATION (hard rule). Never use an em dash (—) or en dash (–) anywhere in a caption: not to join two clauses, not for an aside, not for emphasis, not in a list. Use a comma or a full stop instead, or a colon where a reveal or list follows. A hyphen (-) is allowed ONLY inside a number range (e.g. sizes 10-12) or a genuinely hyphenated word. Em and en dashes are the single most common voice error in drafts, so check every caption for them before you output it.
- Never LEAD with ethics or sustainability credentials. Certifications and factory facts may appear in the middle or close, never the opening line.
- On product posts, lead with the colourway/shade name as the hero concept, not a dry product description.
- Refer to a garment as "she/her" after first introducing it.
- SIGN-OFFS — apply voice.md's sign-off table by post-type, and apply it BOTH ways:
    - Founder and personal posts (the client's founder-voice and personal pillars, per PLANNING CONFIG), and end-of-week or founder-to-camera Reels where the founder is the face of the content, GET the founder's sign-off exactly as voice.md's sign-off table specifies.
    - Product, launch, educational, testimonial, WSG and Sunday Style posts get NO sign-off. They close on a CTA, a question, outfit credits, or a brand line.
    Follow voice.md's sign-off table exactly. Do NOT default to no-sign-off everywhere, and do NOT sign off everything.
- UK spelling and the pound sign throughout.
- PRODUCTS: name ONLY real products and real colourways from the PRODUCTS list, and never pair a product with a colourway not listed under it. Do NOT invent a product name, a colourway, or a product+colourway combination. If the intake needs something not in the list, describe it generically without naming a colourway.
- GARMENT NAMING: when a post features or recommends a garment, ALWAYS name the specific client product, with its proper name and colourway on first mention (e.g. "the Wren Organic Cotton Ecru Vest", then "Wren" afterwards), taken from the PRODUCTS list. NEVER leave a featured garment as a generic category ("a vest", "the classic T-shirt", "a good skirt"). This applies in EVERY post type, INCLUDING standard-week Sunday Style and other soft or low-push posts: naming the specific garment is NOT a sales push, so keep the warm, low-pressure tone but name what you reference. Only genuinely range-level brand language ("our organic cotton basics", "the pieces we keep coming back to") may stay general.
- TEE vs T-SHIRT: use the client's own catalogue naming for the formal product name (for many brands this is "T-Shirt"). "tee" is fine as casual body-copy variation ("a good tee", "the tees") where the client's voice uses it naturally. Do NOT arbitrarily mix the two within a single caption: the casual form should be a deliberate choice, not random alternation. When you are formally naming a product, use the catalogue's formal name.
- VOICE PER POST TYPE: this client writes different kinds of post in different voices. Some are the founder's first-person voice ("I", "my"), others are the brand's "we"/"our" voice. Match how THIS client actually writes that kind of post, following voice.md and the client's own past posts. Do NOT assume a pillar maps to a fixed voice, and do NOT force a topic (for example a sustainability or behind-the-scenes post) into the founder's voice just because it feels personal. Informational and product posts are usually the brand "we" voice even when the pillar is about ethics or origin; reserve the founder's "I" voice for genuine founder-story and personal posts. When unsure, follow voice.md.
- DEPTH: write complete, developed captions. Match the depth, rhythm and specificity of the WORKED EXAMPLES below, not a thin summary.

WORKED EXAMPLES (these show the target depth, voice and sign-off discipline. Do not copy them — match their quality for this client and month):

Example A — product launch (Sprigly, Reel, colourway as hero, garment as "she", NO sign-off, closes on a CTA):
Hello again, sage green Rowan. We've missed you 🙌
Sage green is the colour that does everything quietly. Softer than black, warmer than grey, and it sits happily next to every other shade you own without a second thought.
Rowan, our authentic organic cotton sweatshirt, has a relaxed, easy fit that skims rather than swamps, in organic cotton that holds its shape wash after wash after wash. The one you pull on without thinking and end up living in all weekend.
She's live now, and clay and indigo are waiting in the wings too.
Come and tell us which colour is calling your name 👇

Example B — ours vs theirs (founder posting, first person, to camera, no competitor brand named, ethics in the middle, signs off "Mara x"):
I bought a high street sweatshirt and one of ours, washed them both ten times, and laid them side by side.
The high street one had bobbled across the back, twisted at the seams and gone soft and shapeless at the cuffs. Ours looked very nearly the way it did on day one.
This is the bit you never see on the hanger. The difference isn't in the first wear, it's somewhere around the fortieth, long after you've forgotten what you paid for it.
Sage green Rowan is built for that fortieth wear. That's the entire point.
Mara x

Example C — Notes from the Founder (the founder's own first-person voice, FULLY DRAFTED, signs off "Much love, Mara x"):
A little note as we head into the new month 🤍
This one has been a big one. New colours came back, old favourites returned, and so many of you found us for the very first time. Welcome, genuinely, I'm so glad you're here.
No grand plans, just more of what we believe in. Pieces made properly, in organic cotton, designed to make getting dressed that little bit more effortless.
Thank you for being here, and for trusting us with something as everyday and as personal as what you put on in the morning. It means more than you know.
Much love, Mara x

OUTPUT. Return ONE JSON object and nothing else, in this exact shape:
{"posts": [ {"date": "", "day": "", "title": "", "category": "", "pillar": "", "format": "", "postingTime": "", "whoPosts": "", "competitorInsight": "", "draftCaption": "", "notes": "", "clientWritesOwn": false} ] }
Use only those field names. Do NOT output CSV, markdown, or any commentary. Do NOT include the client's amendment columns — those are added blank later.
Fill EVERY field for every post, including a full draftCaption for founder-voice posts such as "Notes from the Founder" (write the founder's note in their voice WITH the sign-off, at the depth of Example C). Set "clientWritesOwn" to false on every post you draft.
ONLY where this client's voice.md explicitly states the client writes a specific post themselves with no Sprigly draft (a genuine no-brief post): set "draftCaption" to "" AND set "clientWritesOwn" to true, and say in notes that the client writes this one. Never leave a caption blank without setting clientWritesOwn to true.$genplan_v5$::text AS body)
INSERT INTO "prompt_templates" ("client_id","workflow_id","step_name","prompt_text","version")
SELECT NULL, 'planning', 'generate-plan', n.body,
  (SELECT max(version) + 1 FROM "prompt_templates"
   WHERE client_id IS NULL AND workflow_id = 'planning' AND step_name = 'generate-plan')
FROM neutral n
WHERE NOT EXISTS (
  SELECT 1 FROM "prompt_templates" p
  WHERE p.client_id IS NULL AND p.workflow_id = 'planning' AND p.step_name = 'generate-plan'
    AND p.prompt_text = n.body
);

-- ── 0077_email_templates — ask/nudge/last_call/plan_ready v1 (guard ADDED) ───
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('ask', 1, true,
  '{{clientName}}: content plan for {{monthLabel}}',
  $body$Hi {{contactName}},

we've taken a look at last month's numbers. Here's where the data's pointing.

{{leanLine}}

To shape next month's content, it'd help to hear your thinking on a few things:

{{questionsBlock}}

You can add your thoughts anytime here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$)
ON CONFLICT DO NOTHING;

INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('nudge', 1, true,
  '{{monthLabel}}: a quick nudge',
  $body$Hi {{contactName}},

{{monthLabel}} generates in {{daysToCutoff}} days — anything happening we should know about? A launch, a date, a story worth telling?

Add anything here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$)
ON CONFLICT DO NOTHING;

INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('last_call', 1, true,
  '{{monthLabel}}: last call',
  $body$Hi {{contactName}},

Quick one — {{monthLabel}} generates tomorrow. If there's anything you'd like in it, now's the moment:
{{intakeLink}}

And if nothing's planned, no problem — we'll build the month and you can adjust anything after.

Thanks,
The Sprigly Team$body$)
ON CONFLICT DO NOTHING;

INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('plan_ready', 1, true,
  '{{clientName}}: your content plan for {{monthLabel}} is ready',
  $body$Hi,

Your Sprigly content plan for {{monthLabel}} is ready.

Open and shape it here:
{{appLink}}

Move posts, edit captions and add ideas — your changes save as you go.

Best,
Sprigly$body$)
ON CONFLICT DO NOTHING;

-- ── 0078_ask_template_v2 — ask v2 insert (guard ADDED) + republish flip ──────
INSERT INTO "email_templates" ("key","version","is_published","subject_template","body_template")
VALUES ('ask', 2, false,
  '{{clientName}}: content plan for {{monthLabel}}',
  $body$Hi {{contactName}},

{{leanLine}}To shape next month's content, it'd help to hear your thinking on a few things:

{{questionsBlock}}

You can add your thoughts anytime here:
{{intakeLink}}

Thanks,
The Sprigly Team$body$)
ON CONFLICT DO NOTHING;

UPDATE "email_templates" SET "is_published" = false WHERE "key" = 'ask' AND "version" = 1;
UPDATE "email_templates" SET "is_published" = true  WHERE "key" = 'ask' AND "version" = 2;

-- ── 0079_themes — Sprigly Coral + Teal (guard ADDED) ─────────────────────────
INSERT INTO themes (name, version, is_active, tokens, contrast) VALUES
(
  'Sprigly Coral', 1, true,
  '{"accent600":"#E8705F","accent700":"#C4523F","accent800":"#8A3323","accent100":"#FADDD6","ink":"#23272F","muted":"#5C6470","line":"#8F9296","lineSoft":"#F4F5F6","danger":"#B23A2E","chrome":"#334155","chromeDeep":"#1E293B","chromeSoft":"#B8BFC9","canvas":"#F2F3F5","surface":"#FFFFFF"}'::jsonb,
  '{"rows":[{"pair":"white on accent-600","ratio":3.04,"passesAA":false,"passesLarge":true},{"pair":"white on accent-700","ratio":4.54,"passesAA":true,"passesLarge":true},{"pair":"accent-800 on accent-100 (tint/text)","ratio":6.35,"passesAA":true,"passesLarge":true},{"pair":"accent-600 on surface","ratio":3.04,"passesAA":false,"passesLarge":true},{"pair":"border on surface","ratio":3.13,"passesAA":false,"passesLarge":true},{"pair":"white on chrome","ratio":10.35,"passesAA":true,"passesLarge":true},{"pair":"chrome-soft on chrome","ratio":5.59,"passesAA":true,"passesLarge":true}],"accent600FillsLargeTextOnly":true,"tintTextPasses":true}'::jsonb
),
(
  'Teal', 1, false,
  '{"accent600":"#14B8A6","accent700":"#0F766E","accent800":"#0C5F58","accent100":"#E6F7F5","ink":"#23272F","muted":"#5C6470","line":"#8F9296","lineSoft":"#F4F5F6","danger":"#B23A2E","chrome":"#334155","chromeDeep":"#1E293B","chromeSoft":"#B8BFC9","canvas":"#F2F3F5","surface":"#FFFFFF"}'::jsonb,
  '{"rows":[{"pair":"white on accent-600","ratio":2.49,"passesAA":false,"passesLarge":false},{"pair":"white on accent-700","ratio":5.47,"passesAA":true,"passesLarge":true},{"pair":"accent-800 on accent-100 (tint/text)","ratio":6.8,"passesAA":true,"passesLarge":true},{"pair":"accent-600 on surface","ratio":2.49,"passesAA":false,"passesLarge":false},{"pair":"border on surface","ratio":3.13,"passesAA":false,"passesLarge":true},{"pair":"white on chrome","ratio":10.35,"passesAA":true,"passesLarge":true},{"pair":"chrome-soft on chrome","ratio":5.59,"passesAA":true,"passesLarge":true}],"accent600FillsLargeTextOnly":true,"tintTextPasses":true}'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;
