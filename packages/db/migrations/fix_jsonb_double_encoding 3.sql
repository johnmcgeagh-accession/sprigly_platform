-- One-off fix: unwrap JSONB columns that were stored as string literals due to
-- double-encoding (postgres.js re-serializing Drizzle's already-stringified values).
--
-- The expression  (col #>> '{}')::jsonb  extracts the inner text of a JSONB string
-- literal and re-parses it as proper JSONB.
--
-- Each UPDATE is guarded by  WHERE jsonb_typeof(col) = 'string'  so it is safe to
-- re-run and only touches affected rows.
--
-- Run once on production after deploying the client.ts serializer fix.

-- incoming_events
UPDATE incoming_events
SET source_metadata = (source_metadata #>> '{}')::jsonb
WHERE jsonb_typeof(source_metadata) = 'string';

UPDATE incoming_events
SET content = (content #>> '{}')::jsonb
WHERE jsonb_typeof(content) = 'string';

-- routing_rules
UPDATE routing_rules
SET match_conditions = (match_conditions #>> '{}')::jsonb
WHERE jsonb_typeof(match_conditions) = 'string';

UPDATE routing_rules
SET destinations = (destinations #>> '{}')::jsonb
WHERE jsonb_typeof(destinations) = 'string';

-- workflow_runs  (output is nullable)
UPDATE workflow_runs
SET output = (output #>> '{}')::jsonb
WHERE output IS NOT NULL AND jsonb_typeof(output) = 'string';

-- audit_log
UPDATE audit_log
SET metadata = (metadata #>> '{}')::jsonb
WHERE jsonb_typeof(metadata) = 'string';

-- approvals
UPDATE approvals
SET output_snapshot = (output_snapshot #>> '{}')::jsonb
WHERE jsonb_typeof(output_snapshot) = 'string';

-- workflow_outputs
UPDATE workflow_outputs
SET output = (output #>> '{}')::jsonb
WHERE jsonb_typeof(output) = 'string';

-- blog_posts
UPDATE blog_posts
SET faq = (faq #>> '{}')::jsonb
WHERE jsonb_typeof(faq) = 'string';

-- clients
UPDATE clients
SET settings = (settings #>> '{}')::jsonb
WHERE jsonb_typeof(settings) = 'string';

-- client_configs
UPDATE client_configs
SET settings = (settings #>> '{}')::jsonb
WHERE jsonb_typeof(settings) = 'string';

-- prospect_sheets
UPDATE prospect_sheets
SET research = (research #>> '{}')::jsonb
WHERE jsonb_typeof(research) = 'string';
