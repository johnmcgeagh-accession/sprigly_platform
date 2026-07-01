-- app_magic_link_tokens: password-less client access to app.sprigly.co.uk.
-- Modelled on triage_digest_tokens but scoped to client+cycle and REVOCABLE
-- (revoked_at) with last_used_at tracking. Revocability is what retires the
-- bearer-token-in-an-inbox risk. The signLink/verifyLink util sits over this;
-- stateless HMAC stays a later swap behind the same interface.
-- Apply manually: psql "<DATABASE_URL>" -f 0051_app_magic_link_tokens.sql

CREATE TABLE IF NOT EXISTS "app_magic_link_tokens" (
  "id"           uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id"    uuid      NOT NULL REFERENCES "clients"("id"),
  "cycle_id"     uuid      NOT NULL REFERENCES "content_cycles"("id"),
  "token"        text      NOT NULL UNIQUE,
  "expires_at"   timestamp NOT NULL,
  "last_used_at" timestamp,
  "revoked_at"   timestamp,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "app_magic_link_tokens_client_cycle_idx"
  ON "app_magic_link_tokens" ("client_id", "cycle_id");
