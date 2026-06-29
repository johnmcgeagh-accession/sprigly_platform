-- client_product_catalogue: authoritative product catalogue (families → colourway
-- variants) parsed from the client's monthly sales export. One row per
-- (client, channel); latest-wins upsert, refreshed each month. The planner selects
-- from it (soft grounding) and is validated against it (hard check) so an invented
-- product/colourway pairing (e.g. "Elle in dark olive") is caught.
--
-- catalogue shape: { families: ProductFamily[], excluded: ParsedProduct[] }
--   (apps/worker/src/catalogue/parse-catalogue.ts)
-- Apply manually: psql "<DATABASE_URL>" -f 0045_client_product_catalogue.sql

CREATE TABLE IF NOT EXISTS "client_product_catalogue" (
  "id"           uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now(),
  "client_id"    uuid      NOT NULL REFERENCES "clients"("id"),
  "channel"      text      NOT NULL,
  "source_month" text,
  "catalogue"    jsonb     NOT NULL DEFAULT '{}'::jsonb,
  "refreshed_at" timestamp NOT NULL,
  CONSTRAINT "client_product_catalogue_unique" UNIQUE ("client_id", "channel")
);

CREATE INDEX IF NOT EXISTS "client_product_catalogue_client_idx"
  ON "client_product_catalogue" ("client_id");
