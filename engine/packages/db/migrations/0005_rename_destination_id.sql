-- Rename destination ID: gmail-reply-prospect-brief → gmail-reply-with-attachment
-- Applies to every routing_rule row whose destinations array contains the old ID.
UPDATE routing_rules
SET destinations = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'destinationId' = 'gmail-reply-prospect-brief'
      THEN jsonb_set(elem, '{destinationId}', '"gmail-reply-with-attachment"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(destinations) AS elem
)
WHERE destinations::text LIKE '%gmail-reply-prospect-brief%';
