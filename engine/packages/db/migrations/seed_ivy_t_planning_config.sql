-- Seed: IVY-t instagram planning config
-- Sources:
--   Pillars:         clients/ivy-t/memory/ivy-t-content-strategy.md
--   Target shares:   sprigly-content-plan skill, Step 6b
--   Competitors:     clients/ivy-t/memory/ivy-t-content-strategy.md (confirmed by Sally 2026-06-17)
--   Format targets:  skill Step 6c
--   Cadence:         skill Step 6a
--   Recurring series: skill Step 6e
--   Posting times:   skill Step 7
--   Categories:      extracted from june + july plan outputs (authoritative)
--
-- NOTE — 7th pillar (A Supportive Friend, Always By Your Side):
--   Appears in content-strategy.md but NOT in the skill's Step 6b target-share table.
--   The 6-pillar table sums to 90% (6×10–25%), leaving ~10% unclaimed.
--   Seeded with 5–10% as a working value. Confirm with John whether this pillar
--   has a target share or should be merged into Personal Relationships.
--
-- Apply: psql "<DATABASE_URL>" -f seed_ivy_t_planning_config.sql

DO $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT id INTO v_client_id FROM clients WHERE slug = 'ivy-t';
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Client ivy-t not found — check slug';
  END IF;

  INSERT INTO client_planning_config (
    client_id,
    channel,
    pillars,
    competitors,
    format_targets,
    cadence,
    recurring_series,
    posting_times,
    categories
  ) VALUES (
    v_client_id,
    'instagram',

    -- ── pillars ──────────────────────────────────────────────────────────────
    -- 7 pillars from content-strategy.md. Target shares from skill Step 6b.
    -- Pillar 7 target share is a working estimate — flag for confirmation.
    '[
      {
        "name": "Simplify Your Morning",
        "tagline": "Getting dressed shouldn''t be another decision in your overwhelming day",
        "keyMessages": [
          "One less thing to worry about",
          "Effortless coordination",
          "Streamlined wardrobe decisions"
        ],
        "targetShareMin": 20,
        "targetShareMax": 25
      },
      {
        "name": "Born From Real Need",
        "tagline": "Created by a woman who couldn''t find what she needed anywhere else",
        "keyMessages": [
          "Authentic founder story",
          "Industry insider knowledge",
          "Personal experience driving innovation"
        ],
        "targetShareMin": 15,
        "targetShareMax": 20
      },
      {
        "name": "Stable Foundations",
        "tagline": "The dependable pieces that make everything else in your wardrobe work better",
        "keyMessages": [
          "Wardrobe foundations",
          "65% customer return rate",
          "Investment pieces that last"
        ],
        "targetShareMin": 15,
        "targetShareMax": 20
      },
      {
        "name": "Ethical Without Compromise",
        "tagline": "Sustainable doesn''t mean settling for less",
        "keyMessages": [
          "GOTS-certified organic cotton (91% less water, 62% less energy than conventional)",
          "Portuguese factory partnership (Sedex-approved, fair wages, solar power)",
          "Quality that honours your investment"
        ],
        "targetShareMin": 10,
        "targetShareMax": 15
      },
      {
        "name": "Understands Real Women",
        "tagline": "Clothes designed for how you actually live",
        "keyMessages": [
          "Flattering fits for real bodies",
          "Move seamlessly through your day",
          "Each piece named after women in Sally''s life"
        ],
        "targetShareMin": 20,
        "targetShareMax": 25
      },
      {
        "name": "Personal Relationships",
        "tagline": "More than a brand — we''re people who genuinely care",
        "keyMessages": [
          "Ask anything, get a straight answer",
          "Generous customer service",
          "Building lasting relationships"
        ],
        "targetShareMin": 10,
        "targetShareMax": 15
      },
      {
        "name": "A Supportive Friend, Always By Your Side",
        "tagline": "Shopping for the perfect clothes should be fun, not a chore",
        "keyMessages": [
          "Be confident you''re investing in the right pieces for you",
          "Feel special in every interaction",
          "Learn to make the most of your unique body and style"
        ],
        "targetShareMin": 5,
        "targetShareMax": 10
      }
    ]'::jsonb,

    -- ── competitors ──────────────────────────────────────────────────────────
    -- 9 handles from content-strategy.md. No @ prefix. LinkedIn TBC (separate channel row).
    -- Confirmed by Sally 2026-06-17; @colorfulstandard added 2026-06-23.
    '["organicbasics", "withnothingunderneath", "_beyond_nine", "lucyandyak", "theslowlove", "notbasics", "navygrey.co", "elevenloves.co.uk", "colorfulstandard"]'::jsonb,

    -- ── format_targets ───────────────────────────────────────────────────────
    -- Skill Step 6c. Reels anchor high-ceiling moments. All values are integer %.
    '{"reelMin": 30, "reelMax": 40, "carouselMin": 40, "carouselMax": 50, "staticMin": 15, "staticMax": 20}'::jsonb,

    -- ── cadence ──────────────────────────────────────────────────────────────
    -- Skill Step 6a. 16–20/month, approx 4/week, max 5/week, min 3/week.
    '{"postsPerMonthMin": 16, "postsPerMonthMax": 20, "maxPerWeek": 5, "minPerWeek": 3}'::jsonb,

    -- ── recurring_series ─────────────────────────────────────────────────────
    -- Skill Step 6e. Four established series.
    -- format null = Sally owns the format; no Sprigly brief.
    '[
      {
        "name": "Sunday Style",
        "dayOfWeek": "Sunday",
        "time": "8pm",
        "format": "Carousel",
        "whoPosts": "Sprigly"
      },
      {
        "name": "WSG (Weekend Style Guide)",
        "dayOfWeek": "Saturday",
        "time": "6pm",
        "format": "Carousel",
        "whoPosts": "Sally posting"
      },
      {
        "name": "Notes from the Founder",
        "dayOfWeek": "monthly",
        "time": "monthly",
        "format": null,
        "whoPosts": "Sally only"
      },
      {
        "name": "What our customers see",
        "dayOfWeek": "monthly",
        "time": "monthly",
        "format": "Carousel",
        "whoPosts": "Sprigly"
      }
    ]'::jsonb,

    -- ── posting_times ────────────────────────────────────────────────────────
    -- Skill Step 7. Standard time slots per post type.
    '{"launch": "6am", "morning": "7am", "evening": "7pm", "wsg": "6pm", "sundayStyle": "8pm"}'::jsonb,

    -- ── categories ───────────────────────────────────────────────────────────
    -- Authoritative list extracted from June + July 2026 plan outputs.
    -- Planning worker must only use values from this list.
    '["Styling", "WSG & Sunday Style", "Brand", "Educational", "Product launch or offer related", "POV", "Testimonials", "Regular feature", "No Post/Sally"]'::jsonb
  )
  ON CONFLICT (client_id, channel) DO UPDATE SET
    pillars          = EXCLUDED.pillars,
    competitors      = EXCLUDED.competitors,
    format_targets   = EXCLUDED.format_targets,
    cadence          = EXCLUDED.cadence,
    recurring_series = EXCLUDED.recurring_series,
    posting_times    = EXCLUDED.posting_times,
    categories       = EXCLUDED.categories,
    updated_at       = now();

  RAISE NOTICE 'IVY-t instagram planning config seeded for client_id %', v_client_id;
END $$;
