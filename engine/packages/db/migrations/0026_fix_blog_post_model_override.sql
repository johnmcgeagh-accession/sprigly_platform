--> statement-breakpoint

-- Ensure the Sprigly client config uses the logical model name "haiku" (not a
-- versioned Anthropic API ID like "claude-haiku-4-5-20251001" which Bedrock rejects)
-- and has explicit stepModels entries for the blog post workflow so model resolution
-- never falls back to the top-level settings.model field.
UPDATE "client_configs"
SET
  "settings" = jsonb_set(
    jsonb_set(
      "settings",
      '{model}',
      '"haiku"'
    ),
    '{stepModels,sprigly-blog-post}',
    '{"research": "haiku", "structure": "haiku", "write": "haiku"}'
  ),
  "updated_at" = now()
WHERE "client_id" = '199678dd-d7d3-4e3b-91b8-8dd8150742d9';
