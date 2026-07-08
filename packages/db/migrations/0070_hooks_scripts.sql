-- 0070: hooks + scripts (redesign Stage 6).
--
-- content_cycle_posts gains hook/script text + a target script length. hook_patterns is
-- a small structural-template library: `pattern` keeps {slot} placeholders so the
-- generation prompt shows the model the STRUCTURE (never the example's content).
-- Selection reads active=true only, so retiring a pattern is an UPDATE, not a deploy.
--
-- Hooks generate for reels + carousels only; scripts for reels only (product decision).
--
-- APPLY-BEFORE-DEPLOY: mapped in the Drizzle schema. Apply before deploy.
-- Apply manually:  psql "<DATABASE_URL>" -f 0070_hooks_scripts.sql
-- Reverse (LOCAL / emergency ONLY):  psql "<DATABASE_URL>" -f 0070_hooks_scripts.down.sql

ALTER TABLE "content_cycle_posts" ADD COLUMN IF NOT EXISTS "hook" text;
ALTER TABLE "content_cycle_posts" ADD COLUMN IF NOT EXISTS "script" text;
ALTER TABLE "content_cycle_posts" ADD COLUMN IF NOT EXISTS "script_length_seconds" integer;

CREATE TABLE IF NOT EXISTS "hook_patterns" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       text NOT NULL,
  "category"   text NOT NULL,
  "pattern"    text NOT NULL,
  "example"    text NOT NULL,
  "formats"    text[] NOT NULL DEFAULT '{}',
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Selection keys: category + formats, filtered to active=true.
CREATE INDEX IF NOT EXISTS "hook_patterns_active_idx" ON "hook_patterns" ("active");

-- Idempotent seed: only when empty, so re-running the migration never duplicates.
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
