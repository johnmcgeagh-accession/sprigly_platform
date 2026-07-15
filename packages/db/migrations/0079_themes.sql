-- 0079_themes — platform-wide design themes (admin-managed, GLOBAL). Deliberately NO client_id
-- column (per-client theming is structurally impossible). Versioned like email_templates; exactly
-- ONE active theme enforced by a PARTIAL unique index. Seeds "Sprigly Coral" (ACTIVE, byte-identical
-- to the closed system) + "Teal" (inactive). Contrast tables computed by @sprigly/engine's
-- computeThemeContrast and stored at seed time.

CREATE TABLE IF NOT EXISTS themes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  tokens     jsonb NOT NULL,
  contrast   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS themes_name_version ON themes (name, version);
-- Exactly one active theme platform-wide.
CREATE UNIQUE INDEX IF NOT EXISTS themes_one_active ON themes (is_active) WHERE is_active = true;

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
);
