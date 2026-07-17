-- 0075_uat_to_prod_delta — bring prod's structure up to UAT (= schema.ts).
--
-- Expand-only forward migration. Adds the 13 tables prod lacks, 11 nullable
-- columns on 3 existing tables, the plan_activity append-only trigger function,
-- and 2 triggers. All DDL copied verbatim from uat_schema.sql (pg_dump of UAT).
--
-- Contains NO drops, NO type changes, NO NOT NULL / unique on existing tables,
-- and NO data. set_updated_at() is intentionally omitted (already exists in prod).
-- Ordering: function -> tables -> PK/unique -> FKs -> indexes -> triggers -> columns,
-- so FK dependencies resolve within the transaction.
--
-- Apply with:
--   psql "<DATABASE_URL>" -f 0075_uat_to_prod_delta.sql

BEGIN;

-- ── 1. Trigger function (used by plan_activity_no_mutate below) ────────────────

CREATE FUNCTION public.plan_activity_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'plan_activity is append-only (% is blocked)', TG_OP;
END;
$$;

-- ── 2. New tables (columns + inline CHECK constraints, verbatim) ──────────────

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    cycle_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_message_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    source text DEFAULT 'web'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    metadata jsonb
);

CREATE TABLE public.agent_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid NOT NULL,
    intent text NOT NULL,
    payload jsonb NOT NULL,
    summary text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    resolved_by text,
    applied_at timestamp without time zone,
    error text,
    change_set_id uuid
);

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_templates_key_check CHECK ((key = ANY (ARRAY['ask'::text, 'nudge'::text, 'last_call'::text, 'plan_ready'::text])))
);

CREATE TABLE public.hook_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    pattern text NOT NULL,
    example text NOT NULL,
    formats text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ig_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL,
    channel text NOT NULL,
    month text NOT NULL,
    posts jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.plan_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    cycle_id uuid,
    post_id uuid,
    origin text NOT NULL,
    action text NOT NULL,
    ref_proposal_id uuid,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plan_activity_origin_check CHECK ((origin = ANY (ARRAY['user'::text, 'agent'::text])))
);

CREATE TABLE public.plan_inputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    cycle_id uuid,
    type text NOT NULL,
    content text NOT NULL,
    source_proposal_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    relevant_from date,
    relevant_to date,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'web'::text NOT NULL,
    consumed_by_proposal_id uuid
);

CREATE TABLE public.post_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    label text NOT NULL,
    lead_days integer NOT NULL,
    done boolean DEFAULT false NOT NULL,
    done_at timestamp with time zone,
    sort integer DEFAULT 0 NOT NULL,
    created_by text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_steps_created_by_check CHECK ((created_by = ANY (ARRAY['agent'::text, 'user'::text])))
);

CREATE TABLE public.step_templates (
    content_type text NOT NULL,
    steps jsonb NOT NULL
);

CREATE TABLE public.themes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    tokens jsonb NOT NULL,
    contrast jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ui_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    event text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.weekly_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    week_start date NOT NULL,
    change_set_id uuid,
    findings jsonb,
    actioned_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- ── 3. Primary keys and unique constraints ────────────────────────────────────

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_proposals
    ADD CONSTRAINT agent_proposals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hook_patterns
    ADD CONSTRAINT hook_patterns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ig_posts
    ADD CONSTRAINT ig_posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ig_posts
    ADD CONSTRAINT ig_posts_unique UNIQUE (client_id, channel, month);

ALTER TABLE ONLY public.plan_activity
    ADD CONSTRAINT plan_activity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plan_inputs
    ADD CONSTRAINT plan_inputs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.post_steps
    ADD CONSTRAINT post_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.step_templates
    ADD CONSTRAINT step_templates_pkey PRIMARY KEY (content_type);

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ui_events
    ADD CONSTRAINT ui_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weekly_sessions
    ADD CONSTRAINT weekly_sessions_pkey PRIMARY KEY (id);

-- ── 4. Foreign keys (all referenced tables/keys now exist) ────────────────────
--     References clients / content_cycles / content_cycle_posts already exist in prod.

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.agent_proposals
    ADD CONSTRAINT agent_proposals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.agent_proposals
    ADD CONSTRAINT agent_proposals_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE ONLY public.agent_proposals
    ADD CONSTRAINT agent_proposals_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.content_cycles(id);

ALTER TABLE ONLY public.ig_posts
    ADD CONSTRAINT ig_posts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.plan_activity
    ADD CONSTRAINT plan_activity_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.plan_activity
    ADD CONSTRAINT plan_activity_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.content_cycles(id);

ALTER TABLE ONLY public.plan_activity
    ADD CONSTRAINT plan_activity_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.content_cycle_posts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.plan_activity
    ADD CONSTRAINT plan_activity_ref_proposal_id_fkey FOREIGN KEY (ref_proposal_id) REFERENCES public.agent_proposals(id);

ALTER TABLE ONLY public.plan_inputs
    ADD CONSTRAINT plan_inputs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.plan_inputs
    ADD CONSTRAINT plan_inputs_consumed_by_proposal_id_fkey FOREIGN KEY (consumed_by_proposal_id) REFERENCES public.agent_proposals(id);

ALTER TABLE ONLY public.plan_inputs
    ADD CONSTRAINT plan_inputs_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.content_cycles(id);

ALTER TABLE ONLY public.plan_inputs
    ADD CONSTRAINT plan_inputs_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES public.agent_proposals(id);

ALTER TABLE ONLY public.post_steps
    ADD CONSTRAINT post_steps_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.content_cycle_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ui_events
    ADD CONSTRAINT ui_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.weekly_sessions
    ADD CONSTRAINT weekly_sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.weekly_sessions
    ADD CONSTRAINT weekly_sessions_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.content_cycles(id);

-- ── 5. Indexes (incl. unique / partial) ───────────────────────────────────────

CREATE INDEX agent_messages_conversation_idx ON public.agent_messages USING btree (conversation_id, created_at);
CREATE INDEX agent_proposals_change_set_idx ON public.agent_proposals USING btree (change_set_id);
CREATE INDEX agent_proposals_client_status_idx ON public.agent_proposals USING btree (client_id, status);
CREATE INDEX conversations_client_idx ON public.conversations USING btree (client_id, last_message_at);
CREATE UNIQUE INDEX email_templates_key_version ON public.email_templates USING btree (key, version);
CREATE UNIQUE INDEX email_templates_published_key ON public.email_templates USING btree (key) WHERE is_published;
CREATE INDEX hook_patterns_active_idx ON public.hook_patterns USING btree (active);
CREATE INDEX plan_activity_client_created_idx ON public.plan_activity USING btree (client_id, created_at);
CREATE INDEX plan_activity_post_id_idx ON public.plan_activity USING btree (post_id);
CREATE INDEX plan_inputs_client_type_idx ON public.plan_inputs USING btree (client_id, type);
CREATE UNIQUE INDEX plan_inputs_source_proposal_uniq ON public.plan_inputs USING btree (source_proposal_id);
CREATE INDEX post_steps_post_id_idx ON public.post_steps USING btree (post_id);
CREATE UNIQUE INDEX themes_name_version ON public.themes USING btree (name, version);
CREATE UNIQUE INDEX themes_one_active ON public.themes USING btree (is_active) WHERE (is_active = true);
CREATE INDEX ui_events_client_created_idx ON public.ui_events USING btree (client_id, created_at);
CREATE INDEX weekly_sessions_client_week_idx ON public.weekly_sessions USING btree (client_id, week_start);

-- ── 6. Triggers (set_updated_at() already exists in prod — not (re)created) ────

CREATE TRIGGER plan_activity_no_mutate BEFORE DELETE OR UPDATE ON public.plan_activity FOR EACH ROW EXECUTE FUNCTION public.plan_activity_append_only();
CREATE TRIGGER post_steps_set_updated_at BEFORE UPDATE ON public.post_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7. Additive columns on existing tables (all nullable, no default) ──────────

ALTER TABLE public.clients ADD COLUMN lat double precision;
ALTER TABLE public.clients ADD COLUMN lon double precision;
ALTER TABLE public.clients ADD COLUMN location_name text;

ALTER TABLE public.content_cycles ADD COLUMN ask_sent_at timestamp without time zone;
ALTER TABLE public.content_cycles ADD COLUMN nudge_sent_at timestamp without time zone;
ALTER TABLE public.content_cycles ADD COLUMN last_call_sent_at timestamp without time zone;
ALTER TABLE public.content_cycles ADD COLUMN ask_skip_reason text;
ALTER TABLE public.content_cycles ADD COLUMN nudge_skip_reason text;
ALTER TABLE public.content_cycles ADD COLUMN last_call_skip_reason text;

ALTER TABLE public.content_cycle_posts ADD COLUMN hook text;
ALTER TABLE public.content_cycle_posts ADD COLUMN script_length_seconds integer;

COMMIT;
