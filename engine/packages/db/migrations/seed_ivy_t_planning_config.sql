-- Seed: IVY-t instagram planning config
-- Sources:
--   pillars          — clients/ivy-t/memory/ivy-t-content-strategy.md (all 7 pillars)
--   competitors      — ivy-t-content-strategy.md (confirmed Sally 2026-06-17; @colorfulstandard added 2026-06-23)
--   cadence          — sprigly-content-plan skill, Step 6a
--   recurring_series — skill Step 6e
--   posting_times    — skill Step 7
--   categories       — extracted from June + July 2026 plan outputs (authoritative starting set)
--
-- format_targets intentionally absent: agent reasons format balance from competitor analysis.
-- Pillar target shares intentionally absent: agent reasons pillar balance at plan time.
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
    cadence,
    recurring_series,
    posting_times,
    categories
  ) VALUES (
    v_client_id,
    'instagram',

    -- ── pillars ──────────────────────────────────────────────────────────────
    -- All 7 pillars from ivy-t-content-strategy.md.
    -- Each: name, tagline (the italic line), keyMessages (bullet points),
    --        contentIdeas (the "Content ideas:" line, split to array).
    '[
      {
        "name": "Simplify Your Morning",
        "tagline": "Getting dressed shouldn''t be another decision in your overwhelming day",
        "keyMessages": [
          "One less thing to worry about",
          "Effortless coordination",
          "Streamlined wardrobe decisions"
        ],
        "contentIdeas": [
          "morning routine",
          "outfit repeating",
          "capsule wardrobe",
          "decision fatigue"
        ]
      },
      {
        "name": "Born From Real Need",
        "tagline": "Created by a woman who couldn''t find what she needed anywhere else",
        "keyMessages": [
          "Authentic founder story",
          "Industry insider knowledge",
          "Personal experience driving innovation"
        ],
        "contentIdeas": [
          "founder story",
          "behind the scenes",
          "why Ivy exists",
          "Sally''s perspective"
        ]
      },
      {
        "name": "Stable Foundations",
        "tagline": "The dependable pieces that make everything else in your wardrobe work better",
        "keyMessages": [
          "Wardrobe foundations",
          "65% customer return rate",
          "Investment pieces that last"
        ],
        "contentIdeas": [
          "styling multiple ways",
          "cost-per-wear",
          "quality longevity",
          "wardrobe building"
        ]
      },
      {
        "name": "Ethical Without Compromise",
        "tagline": "Sustainable doesn''t mean settling for less",
        "keyMessages": [
          "GOTS-certified organic cotton (91% less water, 62% less energy than conventional)",
          "Portuguese factory partnership (Sedex-approved, fair wages, solar power)",
          "Quality that honours your investment"
        ],
        "contentIdeas": [
          "factory stories",
          "sustainability facts",
          "organic cotton benefits",
          "slow fashion"
        ]
      },
      {
        "name": "Understands Real Women",
        "tagline": "Clothes designed for how you actually live",
        "keyMessages": [
          "Flattering fits for real bodies",
          "Move seamlessly through your day",
          "Each piece named after women in Sally''s life"
        ],
        "contentIdeas": [
          "customer stories",
          "real body celebration",
          "life stages",
          "relatable moments"
        ]
      },
      {
        "name": "Personal Relationships",
        "tagline": "More than a brand — we''re people who genuinely care",
        "keyMessages": [
          "Ask anything, get a straight answer",
          "Generous customer service",
          "Building lasting relationships"
        ],
        "contentIdeas": [
          "customer testimonials",
          "Sally responding personally",
          "sizing help",
          "community"
        ]
      },
      {
        "name": "A Supportive Friend, Always By Your Side",
        "tagline": "Shopping for the perfect clothes should be fun, not a chore",
        "keyMessages": [
          "Be confident you''re investing in the right pieces for you",
          "Feel special in every interaction",
          "Learn to make the most of your unique body and style"
        ],
        "contentIdeas": [
          "sizing guides",
          "styling advice",
          "personal shopping",
          "outfit help"
        ]
      }
    ]'::jsonb,

    -- ── competitors ──────────────────────────────────────────────────────────
    -- 9 Instagram handles. No @ prefix. Order matches content-strategy.md.
    '["organicbasics", "withnothingunderneath", "_beyond_nine", "lucyandyak", "theslowlove", "notbasics", "navygrey.co", "elevenloves.co.uk", "colorfulstandard"]'::jsonb,

    -- ── cadence ──────────────────────────────────────────────────────────────
    -- Skill Step 6a. 16–20/month, ~4/week default, max 5, min 3.
    '{"postsPerMonthMin": 16, "postsPerMonthMax": 20, "maxPerWeek": 5, "minPerWeek": 3}'::jsonb,

    -- ── recurring_series ─────────────────────────────────────────────────────
    -- Skill Step 6e. Four established series carried forward each month.
    -- format null = Sally owns format; no Sprigly brief for that field.
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
    -- Skill Step 7. Standard slot labels used in the plan CSV.
    '{"launch": "6am", "morning": "7am", "evening": "7pm", "wsg": "6pm", "sundayStyle": "8pm"}'::jsonb,

    -- ── categories ───────────────────────────────────────────────────────────
    -- Authoritative vocabulary for the Category column. Extracted from June and
    -- July 2026 plan outputs. Planning worker must only use values from this list.
    '["Styling", "WSG & Sunday Style", "Brand", "Educational", "Product launch or offer related", "POV", "Testimonials", "Regular feature", "No Post/Sally"]'::jsonb
  )
  ON CONFLICT (client_id, channel) DO UPDATE SET
    pillars          = EXCLUDED.pillars,
    competitors      = EXCLUDED.competitors,
    cadence          = EXCLUDED.cadence,
    recurring_series = EXCLUDED.recurring_series,
    posting_times    = EXCLUDED.posting_times,
    categories       = EXCLUDED.categories,
    updated_at       = now();

  RAISE NOTICE 'IVY-t instagram planning config seeded for client_id %', v_client_id;
END $$;
