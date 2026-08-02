import { ne, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  boolean,
  integer,
  numeric,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from '@sprigly/embedding-client';

/** Serialises a float array to the PostgreSQL vector literal `[x,y,...]`. */
export function serializeVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

const pgVector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return serializeVector(value);
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});

// ─── shared column helpers ───────────────────────────────────────────────────

const baseColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
};

// ─── clients ─────────────────────────────────────────────────────────────────

export type ClientStatus = 'active' | 'paused' | 'archived';

export const clients = pgTable('clients', {
  ...baseColumns,
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('active'),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  verifiedDomain: text('verified_domain'),
  contentCycleEnabled: boolean('content_cycle_enabled').notNull().default(false),
  // Client location for the weekly session's weather audit (migration 0064).
  // Nullable — a session skips the weather pass entirely when these are unset.
  lat:          doublePrecision('lat'),
  lon:          doublePrecision('lon'),
  locationName: text('location_name'),
});

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

// ─── users ───────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'client_admin' | 'client_user';

export const users = pgTable('users', {
  ...baseColumns,
  email: text('email').notNull().unique(),
  role: text('role').notNull(),
  clientId: uuid('client_id').references(() => clients.id),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── client_configs ───────────────────────────────────────────────────────────

export const clientConfigs = pgTable('client_configs', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  brandVoice: text('brand_voice'),
  signature: text('signature'),
  authorName: text('author_name'),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
});

export type ClientConfig = typeof clientConfigs.$inferSelect;
export type NewClientConfig = typeof clientConfigs.$inferInsert;

// ─── oauth_connections ────────────────────────────────────────────────────────

export type OAuthProvider = 'gmail' | 'outlook' | 'slack';
export type OAuthStatus = 'active' | 'revoked' | 'error';
export type PollingMode = 'selective' | 'full';

export const oauthConnections = pgTable('oauth_connections', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  provider: text('provider').notNull(),
  encryptedTokens: text('encrypted_tokens').notNull(),
  encryptedDataKey: text('encrypted_data_key').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'`),
  emailAddress: text('email_address'),
  status: text('status').notNull().default('active'),
  pollingMode: text('polling_mode').notNull().default('selective'),
  lastPolledAt: timestamp('last_polled_at').default(sql`now()`),
  // Health (0055): last successful token use; last auth error + when. status flips
  // to 'error' on invalid_grant so pollers (where status='active') back off.
  lastOkAt:     timestamp('last_ok_at', { withTimezone: true }),
  lastError:    text('last_error'),
  lastErrorAt:  timestamp('last_error_at', { withTimezone: true }),
});

export type OAuthConnection = typeof oauthConnections.$inferSelect;
export type NewOAuthConnection = typeof oauthConnections.$inferInsert;

// ─── routing_rules ────────────────────────────────────────────────────────────

export const routingRules = pgTable('routing_rules', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  enabled: boolean('enabled').notNull().default(true),
  source: text('source').notNull(),
  matchConditions: jsonb('match_conditions')
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default([]),
  workflowId: text('workflow_id').notNull(),
  destinations: jsonb('destinations')
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default([]),
  clientConfigId: uuid('client_config_id').references(() => clientConfigs.id),
  priority: integer('priority').notNull().default(0),
  isFallback: boolean('is_fallback').notNull().default(false),
  autoCreated: boolean('auto_created').notNull().default(false),
});

export type RoutingRule = typeof routingRules.$inferSelect;
export type NewRoutingRule = typeof routingRules.$inferInsert;

// ─── prompt_templates ─────────────────────────────────────────────────────────

export const promptTemplates = pgTable(
  'prompt_templates',
  {
    ...baseColumns,
    clientId: uuid('client_id').references(() => clients.id),
    workflowId: text('workflow_id').notNull(),
    stepName: text('step_name').notNull(),
    promptText: text('prompt_text').notNull(),
    version: integer('version').notNull().default(1),
    // Provenance: set when this row was created by copying a shared default.
    // Allows detecting drift between client overrides and the shared template.
    copiedFromTemplateId: uuid('copied_from_template_id'),
    copiedFromVersion: integer('copied_from_version'),
  },
  (t) => ({
    uniqPromptVersion: uniqueIndex('prompt_templates_unique_version').on(
      t.clientId,
      t.workflowId,
      t.stepName,
      t.version,
    ),
  }),
);

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;

// ─── email_templates ──────────────────────────────────────────────────────────
// Platform-level GLOBAL email copy (intake-capture Build 2). NO client_id by
// construction — no per-client forks. Versioned; the PUBLISHED row per key is the one
// resolved. "one published per key" is enforced by a PARTIAL unique index defined in
// migration 0077 (email_templates_published_key … WHERE is_published) — not expressible
// in drizzle's index builder, so it lives in the migration only (runtime-irrelevant here).

export const emailTemplates = pgTable(
  'email_templates',
  {
    id:              uuid('id').primaryKey().defaultRandom(),
    key:             text('key').notNull(),   // 'ask' | 'nudge' | 'last_call' | 'plan_ready'
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate:    text('body_template').notNull(),
    version:         integer('version').notNull().default(1),
    isPublished:     boolean('is_published').notNull().default(false),
    createdAt:       timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    keyVersionUniq: uniqueIndex('email_templates_key_version').on(t.key, t.version),
  }),
);

export type EmailTemplate    = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
// 'ask_drafted' is the Ask touch when a draft plan exists for the cycle (Build A). It is a
// SEPARATE key rather than a new version of 'ask' because the resolver picks the highest
// published version per key — two variants under one key could not be chosen between.
// Cycles without a draft keep rendering 'ask' exactly as before.
// 'plan_ready_auto' is the plan-ready email for a month that went ahead WITHOUT the
// client approving (D3). Separate key for the same reason as ask_drafted — the
// resolver picks the highest published version per key. Telling a client their plan
// is ready as though they asked for it, when they simply did not answer, is the kind
// of small dishonesty that makes them distrust the rest of the message.
export type EmailTemplateKey = 'ask' | 'ask_drafted' | 'nudge' | 'last_call' | 'plan_ready' | 'plan_ready_auto';

// ─── themes ───────────────────────────────────────────────────────────────────
// Platform-wide design themes (admin-managed, GLOBAL — deliberately NO client_id column, so
// per-client theming is structurally impossible). Versioned like email_templates (an edit is a
// new (name, version) row); exactly ONE row is active platform-wide, enforced by a PARTIAL unique
// index on is_active WHERE is_active = true. `tokens` holds the ~15 design tokens; `contrast` holds
// the computed WCAG table + gate verdict stored at save/activate time.
export const themes = pgTable(
  'themes',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    name:      text('name').notNull(),
    version:   integer('version').notNull().default(1),
    tokens:    jsonb('tokens').$type<Record<string, string>>().notNull(),
    contrast:  jsonb('contrast').$type<Record<string, unknown>>().notNull().default({}),
    isActive:  boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    nameVersionUniq: uniqueIndex('themes_name_version').on(t.name, t.version),
    // Exactly one active theme platform-wide.
    oneActive: uniqueIndex('themes_one_active').on(t.isActive).where(sql`${t.isActive} = true`),
  }),
);

export type Theme    = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;

// ─── incoming_events ──────────────────────────────────────────────────────────

export type EventStatus =
  | 'received'
  | 'routing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'ignored';

export const incomingEvents = pgTable('incoming_events', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  source: text('source').notNull(),
  sourceMetadata: jsonb('source_metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at').notNull(),
  status: text('status').notNull().default('received'),
  externalId: text('external_id'),
});

export type IncomingEvent = typeof incomingEvents.$inferSelect;
export type NewIncomingEvent = typeof incomingEvents.$inferInsert;

// ─── workflow_runs ────────────────────────────────────────────────────────────

export type WorkflowRunStatus = 'running' | 'completed' | 'failed';
export type WorkflowOutcome = 'handled' | 'needs_human' | 'deferred';

export const workflowRuns = pgTable('workflow_runs', {
  ...baseColumns,
  eventId: uuid('event_id').notNull().references(() => incomingEvents.id),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  workflowId: text('workflow_id').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: text('error'),
  outcome: text('outcome').notNull().default('handled'),
});

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

// ─── audit_log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  eventId: uuid('event_id').references(() => incomingEvents.id),
  workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id),
  action: text('action').notNull(),
  modelId: text('model_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  /**
   * Cost in PENCE, to six decimal places (micropence). Same unit it always was — a 1 here
   * meant one penny before migration 0091 and means one penny after; the column simply stopped
   * being unable to hold 0.55.
   *
   * It was `integer`, and `computeCostPence` ceil'd to it, so every call that genuinely cost a
   * fraction of a penny posted as a whole penny. On the conversational path that is not a
   * rounding artefact but the entire measurement: a Haiku parse turn (~0.55p) and a Titan query
   * embed (~0.00008p) both posted as 1p, indistinguishable from each other and from a call that
   * really did cost a penny.
   *
   * numeric, not float: these values are summed across thousands of rows for a spend figure, and
   * numeric sums exactly where doubles drift. Drizzle types a numeric column as `string` — the
   * audit logger formats on write and the admin surface parses on read, which is also the point
   * at which rounding for DISPLAY happens (£x.xx), and the only point at which it happens.
   */
  costPence: numeric('cost_pence', { precision: 12, scale: 6 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

// ─── approvals ────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const approvals = pgTable('approvals', {
  ...baseColumns,
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id),
  status: text('status').notNull().default('pending'),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  decidedAt: timestamp('decided_at'),
  outputSnapshot: jsonb('output_snapshot').$type<Record<string, unknown>>().notNull(),
});

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

// ─── processed_external_ids ───────────────────────────────────────────────────

export const processedExternalIds = pgTable(
  'processed_external_ids',
  {
    ...baseColumns,
    clientId: uuid('client_id').notNull().references(() => clients.id),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    processedAt: timestamp('processed_at').notNull(),
  },
  (t) => ({
    uniqExternalId: uniqueIndex('processed_external_ids_unique').on(
      t.clientId,
      t.source,
      t.externalId,
    ),
  }),
);

export type ProcessedExternalId = typeof processedExternalIds.$inferSelect;
export type NewProcessedExternalId = typeof processedExternalIds.$inferInsert;

// ─── blog_posts ───────────────────────────────────────────────────────────────

export type BlogPostStatus = 'draft' | 'review' | 'published' | 'archived';

export const blogPosts = pgTable(
  'blog_posts',
  {
    ...baseColumns,
    clientId: uuid('client_id').notNull().references(() => clients.id),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    body: text('body').notNull(),
    excerpt: text('excerpt'),
    metaDescription: text('meta_description'),
    targetKeyword: text('target_keyword'),
    category: text('category'),
    author: text('author'),
    status: text('status').notNull().default('draft'),
    cta: text('cta'),
    previewToken: text('preview_token').notNull().unique(),
    publishToken: text('publish_token').notNull().unique(),
    researchNotes: text('research_notes'),
    faq: jsonb('faq').$type<Array<Record<string, unknown>>>().default([]).notNull(),
  },
  (t) => ({
    uniqClientSlug: uniqueIndex('blog_posts_client_slug').on(t.clientId, t.slug),
  }),
);

export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;

// ─── prospect_sheets ──────────────────────────────────────────────────────────

// ─── workflow_outputs ─────────────────────────────────────────────────────────
// Generic output store for workflows that don't warrant a specialised table.
// blog_posts and prospect_sheets are exempt — they have their own tables.

export type WorkflowOutputStatus = 'draft' | 'delivered' | 'archived';

export const workflowOutputs = pgTable('workflow_outputs', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id),
  workflowId: text('workflow_id').notNull(),
  output: jsonb('output').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('draft'),
});

export type WorkflowOutput = typeof workflowOutputs.$inferSelect;
export type NewWorkflowOutput = typeof workflowOutputs.$inferInsert;

// ─── prospect_sheets ──────────────────────────────────────────────────────────

export const prospectSheets = pgTable('prospect_sheets', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  brandName: text('brand_name').notNull(),
  url: text('url'),
  sector: text('sector'),
  research: jsonb('research').$type<Record<string, unknown>>().default({}).notNull(),
  sheetMarkdown: text('sheet_markdown'),
  notes: text('notes'),
  meetingDate: text('meeting_date'),
});

export type ProspectSheet = typeof prospectSheets.$inferSelect;
export type NewProspectSheet = typeof prospectSheets.$inferInsert;

// ─── triage_configs ──────────────────────────────────────────────────────────
// Per-tenant configuration for the sprigly-inbox-triage workflow.
// categories JSONB shape: TriageCategory[] (defined in packages/engine/src/types.ts)
// reply_examples JSONB shape: ReplyExample[] (defined in packages/engine/src/types.ts)

export type DigestCadence = 'twice_daily' | 'end_of_day' | 'end_of_week';

export const triageConfigs = pgTable('triage_configs', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  categories: jsonb('categories').$type<Array<Record<string, unknown>>>().notNull().default([]),
  voiceSample: text('voice_sample').notNull().default(''),
  replyExamples: jsonb('reply_examples').$type<Array<Record<string, unknown>>>().notNull().default([]),
  additionalInstructions: text('additional_instructions'),
  digestCadence: text('digest_cadence').notNull().default('end_of_day'),
  lastDigestSentAt: timestamp('last_digest_sent_at'),
});

export type TriageConfig = typeof triageConfigs.$inferSelect;
export type NewTriageConfig = typeof triageConfigs.$inferInsert;

// ─── triage_capture_log ───────────────────────────────────────────────────────
// One row per triage suggestion, created by sprigly-inbox-triage for every
// classified email. Decision/correctionType are null until a human resolves.
// decision: 'approved_as_is' | 'modified' | 'rejected'
// correction_type: 'voice' | 'substance' | 'routing' | 'none'

export type TriageDecision = 'approved_as_is' | 'modified' | 'rejected';
export type CorrectionType = 'voice' | 'substance' | 'routing' | 'none';

export const triageCaptureLog = pgTable('triage_capture_log', {
  ...baseColumns,
  clientId: uuid('client_id').notNull().references(() => clients.id),
  eventId: uuid('event_id').notNull().references(() => incomingEvents.id),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id),
  category: text('category').notNull(),
  suggestedAction: text('suggested_action').notNull(),
  draftText: text('draft_text'),
  escalationReason: text('escalation_reason'),
  gmailDraftId: text('gmail_draft_id'),
  decision: text('decision'),
  correctionType: text('correction_type'),
  finalAction: text('final_action'),
  finalText: text('final_text'),
  decidedAt: timestamp('decided_at'),
  decidedBy: uuid('decided_by').references(() => users.id),
});

export type TriageCaptureLogEntry = typeof triageCaptureLog.$inferSelect;
export type NewTriageCaptureLogEntry = typeof triageCaptureLog.$inferInsert;

// ─── triage_seen_messages ─────────────────────────────────────────────────────
// The triage agent's own seen-log, decoupled from Gmail read-state and from
// the poller's processed_external_ids watermark. Written after successful
// classification. Unique on (client_id, message_id).

export const triageSeenMessages = pgTable(
  'triage_seen_messages',
  {
    ...baseColumns,
    clientId: uuid('client_id').notNull().references(() => clients.id),
    messageId: text('message_id').notNull(),
    threadId: text('thread_id').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => ({
    uniqSeenMessage: uniqueIndex('triage_seen_messages_unique').on(t.clientId, t.messageId),
  }),
);

export type TriageSeenMessage = typeof triageSeenMessages.$inferSelect;
export type NewTriageSeenMessage = typeof triageSeenMessages.$inferInsert;

// ─── triage_digest_tokens ─────────────────────────────────────────────────────
// One active token per tenant. Lookup-or-create: if an unexpired token exists
// when a digest fires, it is reused and its expiry is extended (sliding 72h).
// The token is the sole auth for the review page (/review/[token]).
// Every capture-log query on that page filters by token.client_id — no
// cross-tenant data is ever accessible through this surface.

export const triageDigestTokens = pgTable('triage_digest_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  clientId:  uuid('client_id').notNull().references(() => clients.id),
  token:     text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type TriageDigestToken = typeof triageDigestTokens.$inferSelect;
export type NewTriageDigestToken = typeof triageDigestTokens.$inferInsert;

// ─── gmail_operation_errors ───────────────────────────────────────────────────

export const gmailOperationErrors = pgTable('gmail_operation_errors', {
  id:           uuid('id').primaryKey().defaultRandom(),
  clientId:     uuid('client_id').notNull().references(() => clients.id),
  operation:    text('operation').notNull(),
  externalId:   text('external_id'),
  errorCode:    text('error_code'),
  errorMessage: text('error_message').notNull(),
  resolved:     boolean('resolved').notNull().default(false),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  resolvedAt:   timestamp('resolved_at'),
});

export type GmailOperationError = typeof gmailOperationErrors.$inferSelect;
export type NewGmailOperationError = typeof gmailOperationErrors.$inferInsert;

// ─── knowledge_topics ─────────────────────────────────────────────────────────

export const knowledgeTopics = pgTable(
  'knowledge_topics',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    clientId:    uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    name:        text('name').notNull(),
    description: text('description'),
    createdAt:   timestamp('created_at').notNull().defaultNow(),
    updatedAt:   timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqClientName: uniqueIndex('knowledge_topics_client_name').on(t.clientId, t.name),
  }),
);

export type KnowledgeTopic = typeof knowledgeTopics.$inferSelect;
export type NewKnowledgeTopic = typeof knowledgeTopics.$inferInsert;

// ─── knowledge_chunks ─────────────────────────────────────────────────────────

export type KnowledgeSourceType = 'faq_scrape' | 'gmail_import' | 'approved_draft' | 'manual';
export type KnowledgeStatusType = 'active' | 'archived' | 'pending_review';

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    clientId:    uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    topicId:     uuid('topic_id').references(() => knowledgeTopics.id, { onDelete: 'set null' }),
    content:     text('content').notNull(),
    summary:     text('summary'),
    keywords:    text('keywords').array().notNull().default(sql`'{}'`),
    embedding:   pgVector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    sourceType:  text('source_type').$type<KnowledgeSourceType>().notNull(),
    sourceRef:   text('source_ref'),
    status:      text('status').$type<KnowledgeStatusType>().notNull().default('active'),
    contentHash: text('content_hash').notNull(),
    createdAt:   timestamp('created_at').notNull().defaultNow(),
    updatedAt:   timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqClientHash: uniqueIndex('knowledge_chunks_client_hash').on(t.clientId, t.contentHash),
  }),
);

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;

// ─── client_channels ─────────────────────────────────────────────────────────
// Per-client, per-channel config: Drive folder pointer + optional inbound-address
// guard. Populated manually at onboarding — this IS the pointer to Drive, not
// derived from it. Status mirrors clients.status convention.

export const clientChannels = pgTable(
  'client_channels',
  {
    ...baseColumns,
    clientId:             uuid('client_id').notNull().references(() => clients.id),
    channel:              text('channel').notNull(),          // 'instagram', 'linkedin', etc.
    inboundAddress:       text('inbound_address'),            // optional sender-email guard
    driveFolderId:        text('drive_folder_id'),            // Google Drive folder ID
    drivePageToken:       text('drive_page_token'),           // changes-feed watermark; null = uninitialized
    status:               text('status').notNull().default('active'),
    instagramHandle:      text('instagram_handle'),
    contactEmail:         text('contact_email'),
    contactName:          text('contact_name'),
    // { day, hour } = the reminder/ask date (gates cycle CREATION, unchanged). Optional
    // cutoffDay = the auto-run (plan-run) date for intake-capture; nullable/absent means
    // auto-run is not configured for this client. JSONB — no migration to add cutoffDay.
    contentCycleSchedule: jsonb('content_cycle_schedule').$type<{ day: number; hour: number; cutoffDay?: number | null } | null>(),
    extraQuestions:       jsonb('extra_questions').$type<string[] | null>(),
    deliverySurface:      text('delivery_surface').notNull().default('both'),  // 'app' | 'sheet' | 'both' (Phase 2)
    // Phase 4 — AI-change allowance (rewrites/regen only; structural edits never counted).
    aiChangeLimit:             integer('ai_change_limit').notNull().default(30),
    aiChangeLimitOverrideUntil: timestamp('ai_change_limit_override_until', { withTimezone: true }),  // future = unlimited
    postsPerWeek:              integer('posts_per_week'),   // null = derive from config/history (unchanged)
  },
  (t) => ({
    uniqClientChannel: uniqueIndex('client_channels_unique').on(t.clientId, t.channel),
  }),
);

export type ClientChannel = typeof clientChannels.$inferSelect;
export type NewClientChannel = typeof clientChannels.$inferInsert;

// ─── voice_snapshots ──────────────────────────────────────────────────────────
// Immutable snapshots of voice.md at each ingestion point. voice.md is derived;
// rollback = find an earlier snapshot and re-write the file.

export const voiceSnapshots = pgTable('voice_snapshots', {
  ...baseColumns,
  clientId:    uuid('client_id').notNull().references(() => clients.id),
  channel:     text('channel').notNull(),
  snapshotMd:  text('snapshot_md').notNull(),   // full channel block at this point
  reason:      text('reason').notNull(),         // 'monthly-ingest' | 'manual-override' | 'rollback' | 'initial'
  sourceMonth: text('source_month'),             // YYYY-MM; null for initial/manual
  runId:       uuid('run_id'),                   // FK to voice_ingestion_runs — set after that row exists
  isCurrent:   boolean('is_current').notNull().default(false),
});

export type VoiceSnapshot = typeof voiceSnapshots.$inferSelect;
export type NewVoiceSnapshot = typeof voiceSnapshots.$inferInsert;

// ─── voice_ingestion_runs ─────────────────────────────────────────────────────
// One row per calendar:detect-edits + voice:ingest pair. The partial unique index
// (in migration SQL) prevents two completed runs for the same client/channel/month.

export const voiceIngestionRuns = pgTable('voice_ingestion_runs', {
  ...baseColumns,
  clientId:   uuid('client_id').notNull().references(() => clients.id),
  channel:    text('channel').notNull(),
  month:      text('month').notNull(),          // YYYY-MM
  status:     text('status').notNull().default('running'),  // running | completed | failed
  editCount:  integer('edit_count'),
  editRate:   numeric('edit_rate', { precision: 5, scale: 2 }),  // fraction, e.g. '0.33'
  snapshotId: uuid('snapshot_id').references(() => voiceSnapshots.id),
  error:      text('error'),
  startedAt:  timestamp('started_at').notNull().defaultNow(),
  endedAt:    timestamp('ended_at'),
});

export type VoiceIngestionRun = typeof voiceIngestionRuns.$inferSelect;
export type NewVoiceIngestionRun = typeof voiceIngestionRuns.$inferInsert;

// ─── voice_edits ─────────────────────────────────────────────────────────────
// Immutable ledger: one row per edited post per ingestion run. Each month's edit
// set is retained forever. contact_amended is null when the client approved as-is.

export const voiceEdits = pgTable(
  'voice_edits',
  {
    ...baseColumns,
    clientId:       uuid('client_id').notNull().references(() => clients.id),
    channel:        text('channel').notNull(),
    month:          text('month').notNull(),         // YYYY-MM
    postIndex:      integer('post_index'),           // 1-based position in edit array
    date:           text('date'),                    // e.g. '16 Jul'
    postTitle:      text('post_title'),
    category:       text('category'),
    pillar:         text('pillar'),
    spriglyDraft:   text('sprigly_draft'),
    contactAmended: text('contact_amended'),         // null = approved draft as-is
    notes:          text('notes'),
    // null until consumed by the daily batch merge; then set to the merge run's id.
    ingestionRunId: uuid('ingestion_run_id').references(() => voiceIngestionRuns.id),
    // null = PENDING (not yet consumed); set by batch merge to mark ingestion time.
    ingestedAt:     timestamp('ingested_at'),
  },
  (t) => ({
    idxClientChannelMonth: index('voice_edits_client_channel_month').on(
      t.clientId, t.channel, t.month,
    ),
  }),
);

export type VoiceEdit = typeof voiceEdits.$inferSelect;
export type NewVoiceEdit = typeof voiceEdits.$inferInsert;

// ─── content_cycles ───────────────────────────────────────────────────────────
// One row per (client, channel, month) orchestration cycle.
// Status is text (not a PG enum) to match the convention used throughout this schema.
// prior_status: set on → failed; read on retry to resume at the correct step.
// pending_deltas_json: RuleDelta[] gate buffer between extract and apply phases.

export type CycleStatus =
  | 'scheduled'
  | 'requested'
  | 'reply_received'
  | 'awaiting_confirmation'
  | 'intake_confirmed'
  | 'planning'
  | 'workbook_built'
  | 'delivered'
  | 'active'
  | 'finalised'
  | 'awaiting_voice_approval'
  | 'voice_merged'
  | 'closed'
  | 'failed';

export const contentCycles = pgTable(
  'content_cycles',
  {
    ...baseColumns,
    clientId:          uuid('client_id').notNull().references(() => clients.id),
    channel:           text('channel').notNull(),
    cycleMonth:        text('cycle_month').notNull(),           // YYYY-MM
    status:            text('status').notNull().default('scheduled'),
    priorStatus:       text('prior_status'),                    // set on →failed; cleared on retry
    intakeSource:      text('intake_source'),                   // 'reply' | 'confirmed' | 'fallback'
    intakeJson:        jsonb('intake_json').$type<unknown>(),
    leanLine:          text('lean_line'),
    draftCsvRef:       text('draft_csv_ref'),                   // Drive file ID
    workbookRef:       text('workbook_ref'),                    // Drive file ID
    pendingDeltasJson: jsonb('pending_deltas_json').$type<unknown>(), // RuleDelta[] gate buffer
    // StructuredBrief (@sprigly/engine) — the parsed launch/restock brief. Typed
    // `unknown` to avoid a @sprigly/db → @sprigly/engine circular import (cast at
    // the read site). REQUIRES migration 0058 applied before this maps in a deploy:
    // select().from(contentCycles) emits every mapped column, so an unapplied
    // column makes all content-cycle reads error until 0058 runs.
    structuredBrief:   jsonb('structured_brief').$type<unknown>(),
    requestSentAt:     timestamp('request_sent_at'),
    remindedAt:        timestamp('reminded_at'),
    // Intake-capture send log (migration 0076): when each outbound touch of the reminder
    // sequence actually SENT. DISTINCT from request_sent_at (legacy request-email DRAFT
    // creation, not a send). Nullable = that touch has not fired for this cycle.
    askSentAt:         timestamp('ask_sent_at'),
    nudgeSentAt:       timestamp('nudge_sent_at'),
    lastCallSentAt:    timestamp('last_call_sent_at'),
    // Per-beat skip reason (migration 0080): WHY a touch left its *_sent_at NULL, so the state is
    // recoverable from the DB alone — a NULL *_sent_at can't distinguish a suppressed beat (input
    // landed) from an attempted-but-unsent one. Mirrors the send log above; NEVER gates sending
    // (the at-most-once guard keys off *_sent_at). Values (cf. ig_input_status house style):
    // has_input | send_failed | no_sender_wired | error. NULL = unknown / predates the column
    // (not backfillable).
    askSkipReason:      text('ask_skip_reason'),
    nudgeSkipReason:    text('nudge_skip_reason'),
    lastCallSkipReason: text('last_call_skip_reason'),
    replyReceivedAt:   timestamp('reply_received_at'),
    deliveredAt:       timestamp('delivered_at'),
    finalisedAt:       timestamp('finalised_at'),
    voiceMergedAt:     timestamp('voice_merged_at'),
    closedAt:          timestamp('closed_at'),
    failedStep:        text('failed_step'),
    // IG input outcome (0056) — distinct from a Drive-file check. See values in the
    // migration header: ok | no_key | no_handle | empty_month | account_mismatch |
    // quota_exhausted | bad_key | error.
    igInputStatus:     text('ig_input_status'),
    igInputDetail:     text('ig_input_detail'),
    igInputCheckedAt:  timestamp('ig_input_checked_at', { withTimezone: true }),
    // Health of the content_cycle_posts write for this cycle's latest plan run:
    // 'synced' (a write committed AND was verified to leave the live posts matching
    // the new plan) | 'out_of_sync' (a write was attempted and failed/rolled back —
    // the app is serving a stale plan) | 'unknown' (a regen threw before a verified
    // write — surface not trusted) | null (legacy). REQUIRES migration 0060.
    postsSyncStatus:   text('posts_sync_status'),
    // Provenance for a VERIFIED 'synced' (0061), so the flag is attributable to one
    // committed write rather than ambient. Both set together with status='synced'
    // and cleared to null on out_of_sync/unknown. REQUIRES migration 0061.
    postsSyncedAt:     timestamp('posts_synced_at'),
    postsSyncedRunId:  text('posts_synced_run_id'),
    // Draft approval (migration 0087, Build D). NULL = never approved. approved_by is
    // 'client' (they pressed the button) or 'auto' (D3: the cutoff arrived and we went
    // ahead). The distinction drives the plan-ready copy — telling a client "you approved
    // this" when they did not would be a small lie with a long tail.
    approvedAt:        timestamp('approved_at'),
    approvedBy:        text('approved_by'),
    // At-most-once stamp for the plan-ready email (migration 0089). NULL = never sent.
    // This column IS the concurrency control: the send is claimed with
    // `SET plan_ready_sent_at = now() WHERE id = $1 AND plan_ready_sent_at IS NULL`, so
    // two workers settling the same cycle at once contend on one row and exactly one wins.
    // Cleared by a cycle reset — it is run state, not history.
    planReadySentAt:   timestamp('plan_ready_sent_at', { withTimezone: true }),
  },
  (t) => ({
    uniqClientChannelMonth: uniqueIndex('content_cycles_unique').on(
      t.clientId, t.channel, t.cycleMonth,
    ),
  }),
);

export type ContentCycle    = typeof contentCycles.$inferSelect;
export type NewContentCycle = typeof contentCycles.$inferInsert;

// ─── client_planning_config ───────────────────────────────────────────────────
// Per-(client, channel) content planning configuration for the planning phase
// of the content-cycle. All JSONB columns have typed shapes defined in
// packages/engine/src/types.ts (Pillar, Cadence, RecurringSeries, PostingTimes).
// format_targets and pillar % shares are intentionally absent — the planning
// agent reasons both from competitor analysis at plan time, not from fixed config.
// categories is authoritative: planning worker must only use values from this list.

export const clientPlanningConfig = pgTable(
  'client_planning_config',
  {
    ...baseColumns,
    clientId:        uuid('client_id').notNull().references(() => clients.id),
    channel:         text('channel').notNull(),
    pillars:         jsonb('pillars').$type<Array<Record<string, unknown>>>().notNull().default([]),
    competitors:     jsonb('competitors').$type<string[]>().notNull().default([]),
    cadence:         jsonb('cadence').$type<Record<string, number>>().notNull().default({}),
    recurringSeries: jsonb('recurring_series').$type<Array<Record<string, unknown>>>().notNull().default([]),
    postingTimes:    jsonb('posting_times').$type<Record<string, string>>().notNull().default({}),
    categories:      jsonb('categories').$type<string[]>().notNull().default([]),
    // Authoritative per-post-type register map (first-person "I" vs brand "we").
    // Shape: { rules: Array<{ type, categoryAny?, titleRegex?, register }>, default }.
    // Consumed by the planning critic (plan-validation.ts resolveRegister) as the
    // ground truth for register — replaces inferring register from historic posts.
    registerMap:     jsonb('register_map').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({
    uniqClientChannel: uniqueIndex('client_planning_config_unique').on(t.clientId, t.channel),
  }),
);

export type ClientPlanningConfig    = typeof clientPlanningConfig.$inferSelect;
export type NewClientPlanningConfig = typeof clientPlanningConfig.$inferInsert;

// ─── competitor_gather_cache ──────────────────────────────────────────────────
// Stores the deterministic gather output (scraped + scored posts) for all
// competitor handles. One row per (client_id, channel). Latest-wins upsert.
//
// raw_data shape: CompetitorGatherData (engine/packages/engine/src/types.ts).
// gatheredAt mirrors the gatheredAt field inside raw_data but is a proper
// column so it can be queried for staleness checks and UI display without
// parsing the JSON blob.
//
// Consumed by the LLM analysis worker (Stage 2) to produce strategic findings.

export const competitorGatherCache = pgTable(
  'competitor_gather_cache',
  {
    ...baseColumns,
    clientId:   uuid('client_id').notNull().references(() => clients.id),
    channel:    text('channel').notNull(),
    gatheredAt: timestamp('gathered_at').notNull(),
    rawData:    jsonb('raw_data').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({
    uniqClientChannel: uniqueIndex('competitor_gather_cache_unique').on(t.clientId, t.channel),
  }),
);

export type CompetitorGatherCacheRow    = typeof competitorGatherCache.$inferSelect;
export type NewCompetitorGatherCacheRow = typeof competitorGatherCache.$inferInsert;

// ─── client_product_catalogue ─────────────────────────────────────────────────
// The authoritative product catalogue (families → colourway variants) parsed from
// the client's monthly sales export. One row per (client, channel); latest-wins
// upsert, refreshed from each month's export. The planner SELECTS from it (soft
// grounding in the prompt) and is VALIDATED against it (hard post-generation check)
// so an invented product/colourway pairing (e.g. "Elle in dark olive") is caught.
//
// catalogue shape: { families: ProductFamily[], excluded: ParsedProduct[] }
//   (apps/worker/src/catalogue/parse-catalogue.ts)

export const clientProductCatalogue = pgTable(
  'client_product_catalogue',
  {
    ...baseColumns,
    clientId:    uuid('client_id').notNull().references(() => clients.id),
    channel:     text('channel').notNull(),
    sourceMonth: text('source_month'),         // YYYY-MM of the sales export
    catalogue:   jsonb('catalogue').$type<Record<string, unknown>>().notNull().default({}),
    refreshedAt: timestamp('refreshed_at').notNull(),
  },
  (t) => ({
    uniqClientChannel: uniqueIndex('client_product_catalogue_unique').on(t.clientId, t.channel),
  }),
);

export type ClientProductCatalogueRow    = typeof clientProductCatalogue.$inferSelect;
export type NewClientProductCatalogueRow = typeof clientProductCatalogue.$inferInsert;

// ─── ig_posts ─────────────────────────────────────────────────────────────────
// Per-(client, channel, month) Instagram post data, re-homed off Google Drive
// (previously instagram-posts-<YYYY-MM>.json files in the client's Drive folder).
// Mirrors competitor_gather_cache's per-(client, channel) JSONB pattern, plus a
// month key (YYYY-MM). Latest-wins upsert per (client_id, channel, month).
//
// posts shape: IgPost[] (engine/src/lean-line.ts igPostSchema) —
//   { timestamp: string, caption?: string, likesCount: int≥0, commentsCount: int≥0 }.
// Typed loosely here (array of records) to avoid a @sprigly/db → engine dependency,
// exactly as structured_brief / catalogue do; the writers validate the shape.
//
// Written by the Apify trawl (engine/src/ig-producer.ts) and the admin IG upload
// (admin/src/lib/ingest/ingest-ig.ts). Read by planning's critic (loadHistoricPosts,
// the two most-recent months, ordered by month desc) and the request-email lean
// line (fetchTopPosts, a single month). The unique (client_id, channel, month)
// index also serves both reads (prefix + ordered scan) — no extra index needed.

export const igPosts = pgTable(
  'ig_posts',
  {
    ...baseColumns,
    clientId: uuid('client_id').notNull().references(() => clients.id),
    channel:  text('channel').notNull(),
    month:    text('month').notNull(),   // YYYY-MM
    posts:    jsonb('posts').$type<Array<Record<string, unknown>>>().notNull().default([]),
  },
  (t) => ({
    uniqClientChannelMonth: uniqueIndex('ig_posts_unique').on(t.clientId, t.channel, t.month),
  }),
);

export type IgPostsRow    = typeof igPosts.$inferSelect;
export type NewIgPostsRow = typeof igPosts.$inferInsert;

// ─── planning_trace ───────────────────────────────────────────────────────────
// Diagnostic, per-step record of the planning validation loop (gate / critic /
// repair / catalogue) for ONE cycle. Captures what every repair actually changed
// (caption before → after), what triggered it, and the token cost per call — the
// before/after states the audit ledger does NOT keep. Purely observational: written
// best-effort during the loop (a write failure never fails the planning run) and
// read back with `pnpm --filter @sprigly/worker planning-trace <cycleId>`.
//
// One row per loop STEP. `seq` is a monotonic per-run ordinal so the interleaved
// gate→repair→critic sequence (and oscillation) reconstructs exactly, even when
// timestamps collide. Not on the hot path; never read by the runtime.

export const planningTrace = pgTable(
  'planning_trace',
  {
    ...baseColumns,
    cycleId:      uuid('cycle_id').notNull().references(() => contentCycles.id),
    seq:          integer('seq').notNull(),                 // per-run monotonic ordinal
    postIndex:    integer('post_index').notNull(),          // index within the generated plan
    postTitle:    text('post_title'),
    targetMonth:  text('target_month'),                     // YYYY-MM being planned
    phase:        text('phase').notNull(),                  // gate | critic | repair | catalogue
    attempt:      integer('attempt'),                       // retry count for this post within the phase
    pass:         boolean('pass'),                          // gate/critic outcome (null for repair/catalogue)
    issues:       jsonb('issues').$type<unknown>(),         // gate issue codes/details OR critic issues[]
    detail:       jsonb('detail').$type<Record<string, unknown>>(), // verdict / triggeredBy / suggested_fix / violations
    captionBefore: text('caption_before'),                  // repair/catalogue: caption before the change
    captionAfter:  text('caption_after'),                   // repair/catalogue: caption after the change
    inputTokens:  integer('input_tokens'),                  // LLM call cost (critic / repair)
    outputTokens: integer('output_tokens'),
    modelId:      text('model_id'),
  },
  (t) => ({
    cycleIdx: index('planning_trace_cycle_idx').on(t.cycleId, t.seq),
  }),
);

export type PlanningTraceRow    = typeof planningTrace.$inferSelect;
export type NewPlanningTraceRow = typeof planningTrace.$inferInsert;

// ─── beat_meta (draft beats) ──────────────────────────────────────────────────
// Why a draft beat exists, in a form that can be recomputed and audited.
//
// rationaleEvidence is STRUCTURED METRIC REFS, never a sentence. Two reasons:
// the phrasing pass (Build A Part 4) takes this as input and may only restate it,
// so prose here would make its output indistinguishable from its input; and the
// graduation loop later needs to compare a beat's stated basis against what the
// post actually did, which requires numbers, not adjectives.
//
// When history is too thin to ground a beat, the evidence says so —
// {basis: 'template', reason: 'insufficient history'} — rather than carrying
// invented metrics. Honest absence over fabricated confidence.
export interface BeatRationaleEvidence {
  /** Where the beat's shape came from.
   *  'observed'     = derived from this client's own ig_posts history
   *  'template'     = the thin-data neutral skeleton (history below the floor)
   *  'client_added' = the client added this beat themselves (Build B)
   *  'client_input' = created by something the client WROTE, quoted in `reason` (Build C)
   *  'emphasis_reweight' = moved by a client emphasis; the old pillar's metrics were
   *                        DROPPED rather than carried, since they no longer describe it */
  basis:            'observed' | 'template' | 'client_added' | 'client_input' | 'emphasis_reweight';
  /** Set only when basis='template' — why the observed path was unavailable. */
  reason?:          string;
  /** Engagement for THIS beat's format, as measured (likes+comments per post). */
  formatEngagement?: { format: string; avgEngagement: number; posts: number };
  /** This pillar's share of the client's configured pillar weights, 0–1. */
  pillarShare?:      number;
  /** The cadence figure the slot count came from, and what it was measured over.
   *  Present on every ASSEMBLED beat (observed and template paths alike). Absent on a
   *  client_added beat, which has no slot-count basis at all — it exists because the
   *  client asked for it. Build A made this required, correctly for the cases that then
   *  existed; Build B introduced one where the only honest value is no value, and a
   *  fabricated {postsPerWeek: 0} would be exactly the invention this contract exists to
   *  prevent. */
  cadenceBasis?:     { postsPerWeek: number; source: 'observed' | 'config'; months: number };
  /** For an experiment slot: how the candidate ranked, and against what. */
  candidateRank?:    { rank: number; of: number; origin: 'client' | 'competitor' };
  /**
   * The catalogue product this beat is about, and the coverage gap that chose it.
   *
   * `lastFeatured` is the date of the most recent ig_posts caption naming this product, or
   * NULL when no caption has ever named it. NULL means "never featured" and is a stronger
   * claim than any date — it must never be rendered, compared, or stored as a zero or an
   * epoch. `mentions` is the caption count behind it, so the client can judge the sample the
   * same way `formatEngagement.posts` lets them judge that one.
   *
   * Its presence is ALSO the phrasing pass's licence: a title may name this product and no
   * other (validatePhrasing, draft-phrasing.ts).
   */
  productCoverage?:  { product: string; lastFeatured: string | null; mentions: number };
  /**
   * The configured recurring series this beat is an instance of.
   *
   * `lastPlanned` is the most recent scheduled_date on which a non-draft content_cycle_posts
   * row carried this series' category, or NULL when the series has never been planned. Read
   * through excludeDraftPosts() — a draft proposing the series is not evidence the series ran.
   * `monthsObserved` is the count of distinct months it appeared in, i.e. the sample.
   *
   * Its presence is the phrasing pass's licence to name the series.
   */
  seriesDue?:        { name: string; dayOfWeek: string; lastPlanned: string | null; monthsObserved: number };
}

export interface BeatMeta {
  /** 'proven' = drawn from what this client's history says works. 'experiment' =
   *  drawn from the ideas backlog under the temperature dial. */
  slotType:          'proven' | 'experiment';
  rationaleEvidence: BeatRationaleEvidence;
  /** plan_inputs.id the experiment came from. Absent on proven slots. */
  sourceRef?:        string;
  /** Gaps the assembler detected (no launch info, no catalogue, thin month).
   *  These become the intake prompts the Ask email asks the client to fill. */
  assumptions?:      string[];
  /** Set by the Build B structural mutations the moment the client edits a beat. Build C's
   *  transforms never auto-replace a touched beat: the client's hand outranks the
   *  algorithm, and silently evicting something they just placed is the fastest way to
   *  lose their trust in the whole surface. */
  clientTouched?:    boolean;
}

// ─── content_cycle_posts ──────────────────────────────────────────────────────
// Structured, per-post representation of a generated plan — the backbone the
// client app (app.sprigly.co.uk / @sprigly/app) reads and (from Phase 2) edits.
// Written by the planning worker as an ADDITIVE dual-write alongside the existing
// CSV → xlsx → Drive path (the CSV stays the live delivery + safety net), and
// backfilled once from the current workbook. source_meta keeps every CSV column
// losslessly so the workbook pipeline is unaffected. No unique on (cycle_id,
// position): batch reorders need transient collisions to be fine — position is an
// unconstrained sort key. updated_at bumps on every write via a trigger (0050).

export const contentCyclePosts = pgTable(
  'content_cycle_posts',
  {
    ...baseColumns,
    cycleId:       uuid('cycle_id').notNull().references(() => contentCycles.id),
    clientId:      uuid('client_id').notNull().references(() => clients.id),
    channel:       text('channel').notNull(),                          // 'instagram' | 'email'
    scheduledDate: date('scheduled_date', { mode: 'string' }).notNull(), // 'YYYY-MM-DD'
    format:        text('format').notNull(),                           // 'reel'|'carousel'|'single'|'email'
    pillar:        text('pillar'),
    caption:       text('caption'),
    status:        text('status').notNull().default('planned'),        // 'planned'|'edited'|'new'
    hook:          text('hook'),                                       // reel/carousel hook — null until generated (migration 0070)
    script:        text('script'),                                     // reel script — null until generated
    scriptLengthSeconds: integer('script_length_seconds'),            // 15|30|60|90 — target for the script (migration 0070)
    overlay:       text('overlay'),                                    // null until generated
    position:      integer('position').notNull().default(0),           // explicit order within the cycle
    sourceMeta:    jsonb('source_meta').$type<Record<string, unknown>>(), // lossless CSV columns
    deletedAt:     timestamp('deleted_at'),                            // soft-delete (Phase 2) — null = live
    // Regen merge provenance (orthogonal to `status`): 'preserved_edit' (kept from
    // the client's prior work), 'preserved_edit_orphan' (kept but names a product no
    // longer in the brief — needs accept/remove), 'regenerated' (fresh from the new
    // plan), null (pre-existing / not yet classified). REQUIRES migration 0059 before
    // deploy — select().from(content_cycle_posts) emits every mapped column.
    reviewState:   text('review_state'),
    // Draft-beat provenance (migration 0084) — non-null ONLY on rows the draft
    // assembler created. See BeatMeta below for the shape and why the evidence is
    // structured rather than prose. NULL = an ordinary plan post.
    beatMeta:      jsonb('beat_meta').$type<BeatMeta>(),
  },
  (t) => ({
    cycleDateIdx: index('content_cycle_posts_cycle_date_idx').on(t.cycleId, t.scheduledDate),
  }),
);

export type ContentCyclePostRow    = typeof contentCyclePosts.$inferSelect;
export type NewContentCyclePostRow = typeof contentCyclePosts.$inferInsert;

// ─── draft beats: the one definition of "not yet part of the plan" ────────────
// A draft beat is a proposed slot the client has NOT approved. It lives in this
// table (D1 — no separate table) so the whole per-post machinery works on it, but
// it is NOT the plan and must never be read as one.
//
// Every plan reader filters with excludeDraftPosts(). The predicate is defined
// ONCE, here, because the readers span three packages (app/, admin/, engine/) and
// a hand-written `ne(status, 'draft')` at ~15 call sites would drift. The audit
// behind this lives in docs/reports/build-a-draft-assembly.md §Part 0.
//
// Belt AND braces: `'draft'` is also a member of the app's PostStatus union and
// its STATUSES coercion set, so a draft row that ever DOES reach the row mapper
// is labelled honestly rather than silently relabelled 'planned'.
export const POST_STATUS_DRAFT = 'draft' as const;

/**
 * The caption the app writes into an added-but-unfilled post, and the exact string the
 * regen merge tests for to classify that post as a disposable placeholder.
 *
 * ONE constant because there were two, and they could never match. `plan-merge.ts` looked
 * for 'Draft idea — tell Sprigly' (em dash, lowercase "tell") while `mutations.ts` wrote
 * 'Draft idea. Tell Sprigly …' (full stop, capital T), so the startsWith check was dead
 * code: unfilled placeholders were never classified disposable and survived a re-merge,
 * contrary to the documented intent.
 *
 * The canonical form is the one the DATABASE carries, not the one that reads better. Dev
 * rows: 4 in the mutations form (2026-07-09 → 07-17, still being written) against 1 in the
 * em-dash form (2026-07-06, and no code writes it any more). The full-stop form won on
 * evidence.
 *
 * Home is @sprigly/db because both consumers already depend on it — app/ and the worker —
 * so this adds no cross-package edge, and because POST_STATUS_DRAFT above is the same kind
 * of thing: a magic value about content_cycle_posts that several packages must agree on.
 */
export const DRAFT_PLACEHOLDER_CAPTION =
  'Draft idea. Tell Sprigly what this post should be about and it\'ll write the caption.';

/** The prefix the merge classifier matches on. Deliberately a PREFIX of the full caption
 *  above, so the two can never drift into disagreeing about what a placeholder looks like. */
export const DRAFT_PLACEHOLDER_PREFIX = 'Draft idea. Tell Sprigly';

/**
 * Does this post have a caption a human wrote or a model generated — as opposed to the
 * scaffolding `addDraft` leaves behind?
 *
 * A placeholder is a column that is not empty and content that does not exist. Anything asking
 * `!post.caption` gets the wrong answer, and two things that spend money did: `/api/plan/script`
 * and the script worker both accepted a placeholder as the subject to build a reel's hook and
 * script around. One predicate, in the package both the app and the worker already import.
 */
export const hasRealCaption = (caption: string | null | undefined): boolean => {
  const c = (caption ?? '').trim();
  return c.length > 0 && !c.startsWith(DRAFT_PLACEHOLDER_PREFIX);
};

/** Drizzle condition: exclude unapproved draft beats from a plan read.
 *  Use in EVERY query that answers "what is the plan?" — client surfaces, the
 *  agent's plan context, cycle counts, the regen classifier, the weekly audit. */
export const excludeDraftPosts = () => ne(contentCyclePosts.status, POST_STATUS_DRAFT);

// ─── app_magic_link_tokens ────────────────────────────────────────────────────
// Password-less client access to app/. Modelled on triage_digest_tokens but
// scoped to client+cycle and REVOCABLE (revoked_at) with last_used_at tracking —
// revocability is what retires the bearer-token-in-an-inbox risk. The
// signLink/verifyLink contract sits over this (stateless HMAC stays a later swap).

export const appMagicLinkTokens = pgTable(
  'app_magic_link_tokens',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    clientId:   uuid('client_id').notNull().references(() => clients.id),
    cycleId:    uuid('cycle_id').notNull().references(() => contentCycles.id),
    token:      text('token').notNull().unique(),
    expiresAt:  timestamp('expires_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt:  timestamp('revoked_at'),
    createdAt:  timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    clientCycleIdx: index('app_magic_link_tokens_client_cycle_idx').on(t.clientId, t.cycleId),
  }),
);

export type AppMagicLinkToken    = typeof appMagicLinkTokens.$inferSelect;
export type NewAppMagicLinkToken = typeof appMagicLinkTokens.$inferInsert;

// ─── post_edits ───────────────────────────────────────────────────────────────
// Audit trail for natural-language caption regens (Phase 3 shape handler): the
// instruction, caption before/after, pass/fail, token cost. Best-effort write off
// the hot path. Diagnostic only — never read by the runtime.

export const postEdits = pgTable(
  'post_edits',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    createdAt:     timestamp('created_at').notNull().defaultNow(),
    postId:        uuid('post_id').notNull().references(() => contentCyclePosts.id),
    cycleId:       uuid('cycle_id').notNull().references(() => contentCycles.id),
    scope:         text('scope').notNull(),                 // 'post' | 'plan'
    instruction:   text('instruction').notNull(),
    captionBefore: text('caption_before'),
    captionAfter:  text('caption_after'),
    passed:        boolean('passed').notNull().default(false),
    tokens:        integer('tokens'),
    // WHO asked for this edit: 'client' | 'operator' | 'agent' (CHECK in 0090). Nullable —
    // every row written before 0090 is honestly unattributed rather than guessed at.
    actor:         text('actor'),
  },
  (t) => ({
    postIdx: index('post_edits_post_idx').on(t.postId),
    // Phase 4 — monthly AI-change usage count (join cycle_id → content_cycles, filter created_at).
    cycleCreatedIdx: index('post_edits_cycle_created_idx').on(t.cycleId, t.createdAt),
  }),
);

export type PostEditRow    = typeof postEdits.$inferSelect;
export type NewPostEditRow = typeof postEdits.$inferInsert;

// ─── plan agent: conversations / agent_messages / agent_proposals / plan_inputs ─
// The proposal-based plan agent (migration 0062). A conversation groups the
// client's messages (typed or dictated) with the agent's replies. Non-structural
// "capture" intents (note_for_month, idea_backlog, next_cycle_input) create an
// agent_proposals row the client approves before anything lands; approval INSERTs
// a plan_inputs row deterministically (no model). Structural/add/rewrite still
// flow through the existing mutation + shape-job pipeline unchanged.
// APPLY-BEFORE-DEPLOY: these are new tables — the proposal endpoints error until
// 0062 is live, but existing content-cycle reads are unaffected.

export const conversations = pgTable(
  'conversations',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    clientId:      uuid('client_id').notNull().references(() => clients.id),
    cycleId:       uuid('cycle_id').references(() => contentCycles.id),   // nullable — not every chat is cycle-bound
    createdAt:     timestamp('created_at').notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index('conversations_client_idx').on(t.clientId, t.lastMessageAt),
  }),
);
export type ConversationRow    = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;

export const agentMessages = pgTable(
  'agent_messages',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    role:           text('role').notNull(),                  // 'user' | 'assistant'
    content:        text('content').notNull(),
    source:         text('source').notNull().default('web'), // 'web' | 'voice'
    createdAt:      timestamp('created_at').notNull().defaultNow(),
    // Voice sessionId (the sprigly-voice integration seam), the intent
    // classification result, and any proposal ids created from this message.
    metadata:       jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    convIdx: index('agent_messages_conversation_idx').on(t.conversationId, t.createdAt),
  }),
);
export type AgentMessageRow    = typeof agentMessages.$inferSelect;
export type NewAgentMessageRow = typeof agentMessages.$inferInsert;

export const agentProposals = pgTable(
  'agent_proposals',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    clientId:       uuid('client_id').notNull().references(() => clients.id),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    messageId:      uuid('message_id').notNull().references(() => agentMessages.id),
    intent:         text('intent').notNull(),                     // move_post|delete_post|rewrite_post|add_post
    payload:        jsonb('payload').$type<Record<string, unknown>>().notNull(),
    summary:        text('summary').notNull(),                    // human-readable before→after with the ask
    status:         text('status').notNull().default('pending'),  // pending|approved|rejected|applied|failed
    // All proposals parsed from ONE message share a change_set_id so the review UI
    // renders (and can approve) them as one unit (migration 0063). Nullable.
    changeSetId:    uuid('change_set_id'),
    createdAt:      timestamp('created_at').notNull().defaultNow(),
    resolvedAt:     timestamp('resolved_at'),
    resolvedBy:     text('resolved_by'),
    appliedAt:      timestamp('applied_at'),
    error:          text('error'),
  },
  (t) => ({
    clientStatusIdx: index('agent_proposals_client_status_idx').on(t.clientId, t.status),
  }),
);
export type AgentProposalRow    = typeof agentProposals.$inferSelect;
export type NewAgentProposalRow = typeof agentProposals.$inferInsert;

export const planInputs = pgTable(
  'plan_inputs',
  {
    id:               uuid('id').primaryKey().defaultRandom(),
    clientId:         uuid('client_id').notNull().references(() => clients.id),
    cycleId:          uuid('cycle_id').references(() => contentCycles.id),   // nullable
    type:             text('type').notNull(),                     // 'note' | 'idea' | 'next_cycle'
    content:          text('content').notNull(),
    // Notes are inert until integrated; relevance window (both nullable) + status
    // scope when they matter (migration 0063). Lifecycle (migration 0064):
    // 'active' → 'integrated' (a proposal consumed it) | 'expired' (relevant_to
    // passed) | 'dismissed' (manual). `source` is where the note came from.
    relevantFrom:     date('relevant_from', { mode: 'string' }),
    relevantTo:       date('relevant_to', { mode: 'string' }),
    status:           text('status').notNull().default('active'),
    source:           text('source').notNull().default('web'),         // 'web' | 'voice' — TRANSPORT
    // ── Backlog columns (migration 0086, Build C) ─────────────────────────────
    // Where the IDEA came from. Distinct from `source`, which records the transport it
    // arrived by ('web' | 'voice'). Two different questions, two columns.
    origin:           text('origin').notNull().default('client'),      // 'client' | 'competitor'
    // MATURITY, orthogonal to `status`'s AVAILABILITY. A 'proven' idea is still 'active',
    // so these cannot be merged without losing information — and keeping them apart is
    // what lets the nine readers hardcoding status='active' keep working untouched.
    // 'candidate' → 'used' → 'measured' → 'proven', plus 'declined' | 'stale'.
    lifecycle:        text('lifecycle').notNull().default('candidate'),
    // WHICH cycle consumed this input. cycle_id is the CAPTURE cycle (deliberately NULL
    // for durable items) and consumed_by_proposal_id points at a proposal, so neither
    // answers this. Without it a durable input is re-read by every overlapping month
    // forever, with no record it was ever acted on.
    usedInCycleId:    uuid('used_in_cycle_id').references(() => contentCycles.id),
    consumedByProposalId: uuid('consumed_by_proposal_id').references(() => agentProposals.id),
    sourceProposalId: uuid('source_proposal_id').references(() => agentProposals.id),
    createdAt:        timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    clientTypeIdx: index('plan_inputs_client_type_idx').on(t.clientId, t.type),
    clientLifecycleIdx: index('plan_inputs_client_lifecycle_idx').on(t.clientId, t.lifecycle),
    // Idempotency backstop: at most one plan_inputs row per source proposal, so a
    // double-approve can never double-insert. (NULLs are distinct, so proposal-less
    // seed rows are still allowed.)
    proposalUniq: uniqueIndex('plan_inputs_source_proposal_uniq').on(t.sourceProposalId),
  }),
);
export type PlanInputRow    = typeof planInputs.$inferSelect;
export type NewPlanInputRow = typeof planInputs.$inferInsert;

// ─── weekly_sessions ────────────────────────────────────────────────────────
// One row per weekly planning session run (migration 0065): the audit findings,
// how many were actioned vs reported-only, and its status. The proposals it
// creates carry the matching change_set_id.

export const weeklySessions = pgTable(
  'weekly_sessions',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    clientId:      uuid('client_id').notNull().references(() => clients.id),
    cycleId:       uuid('cycle_id').notNull().references(() => contentCycles.id),
    weekStart:     date('week_start', { mode: 'string' }).notNull(),   // Monday, 'YYYY-MM-DD'
    changeSetId:   uuid('change_set_id'),                              // groups the proposals it created
    findings:      jsonb('findings').$type<unknown>(),
    actionedCount: integer('actioned_count').notNull().default(0),
    skippedCount:  integer('skipped_count').notNull().default(0),
    status:        text('status').notNull().default('proposed'),       // 'proposed' | 'quiet' | 'failed'
    createdAt:     timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    clientWeekIdx: index('weekly_sessions_client_week_idx').on(t.clientId, t.weekStart),
  }),
);
export type WeeklySessionRow    = typeof weeklySessions.$inferSelect;
export type NewWeeklySessionRow = typeof weeklySessions.$inferInsert;

// ─── post_steps ───────────────────────────────────────────────────────────────
// Production checklist for a content_cycle_post (redesign Stage 1, migration 0066).
// One row per step. Derivations — due_date = scheduled_date − lead_days, at-risk,
// and the done/total ring — are COMPUTED in app code (app/src/lib/checklist.ts),
// never stored. created_by records whether the agent or the user added the step.
// Cascade-deletes with its post. updated_at is bumped by the shared 0050 trigger.
export type StepActor = 'agent' | 'user';

export const postSteps = pgTable(
  'post_steps',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    postId:    uuid('post_id').notNull().references(() => contentCyclePosts.id, { onDelete: 'cascade' }),
    label:     text('label').notNull(),
    leadDays:  integer('lead_days').notNull(),
    done:      boolean('done').notNull().default(false),
    doneAt:    timestamp('done_at', { withTimezone: true }),
    sort:      integer('sort').notNull().default(0),
    createdBy: text('created_by').notNull().default('user'),   // 'agent' | 'user' (CHECK in 0066)
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    postIdx: index('post_steps_post_id_idx').on(t.postId),
  }),
);
export type PostStepRow    = typeof postSteps.$inferSelect;
export type NewPostStepRow = typeof postSteps.$inferInsert;

// ─── step_templates ─────────────────────────────────────────────────────────
// Default checklist per content-type (redesign Stage 1, migration 0067). content_type
// uses the post FORMAT enum values ('reel' | 'carousel' | 'single'), NOT the mockup
// labels — see design/DECISIONS.md §Content-type mapping. steps is the ordered
// template that POST /checklist/generate instantiates into post_steps.
export interface StepTemplateEntry { label: string; leadDays: number }

export const stepTemplates = pgTable('step_templates', {
  contentType: text('content_type').primaryKey(),                        // a post FORMAT value
  steps:       jsonb('steps').$type<StepTemplateEntry[]>().notNull(),
});
export type StepTemplateRow    = typeof stepTemplates.$inferSelect;
export type NewStepTemplateRow = typeof stepTemplates.$inferInsert;

// ─── plan_activity ──────────────────────────────────────────────────────────
// Append-only ledger of plan changes (redesign Stage 1, AUDIT.md §3, migration 0068).
// ONE ordered stream regardless of actor: manual edits insert origin='user'; approved
// agent proposals insert origin='agent' + ref_proposal_id. Append-only is enforced at
// the DB layer by a BEFORE UPDATE OR DELETE trigger (0068), not just by convention —
// there is intentionally no update/delete helper. post_id is ON DELETE SET NULL so the
// history survives a (hard) post delete.
export type ActivityOrigin = 'user' | 'agent';

export const planActivity = pgTable(
  'plan_activity',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    clientId:      uuid('client_id').notNull().references(() => clients.id),
    cycleId:       uuid('cycle_id').references(() => contentCycles.id),         // nullable
    postId:        uuid('post_id').references(() => contentCyclePosts.id, { onDelete: 'set null' }),
    origin:        text('origin').notNull(),                                    // 'user' | 'agent' (CHECK in 0068)
    action:        text('action').notNull(),                                    // 'rescheduled' | 'caption_saved' | …
    refProposalId: uuid('ref_proposal_id').references(() => agentProposals.id),  // set when origin='agent'
    // WHO, at a finer grain than `origin`. origin's 'user' conflates the client editing their
    // own month with an operator doing it for them, which is exactly the distinction the
    // untouched-post rate needs. 'client' | 'operator' | 'agent' (CHECK in 0090), nullable —
    // pre-0090 rows stay unattributed, because nothing in them says which it was.
    actor:         text('actor'),
    payload:       jsonb('payload').$type<Record<string, unknown>>(),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientCreatedIdx: index('plan_activity_client_created_idx').on(t.clientId, t.createdAt),
    postIdx:          index('plan_activity_post_id_idx').on(t.postId),
  }),
);
export type PlanActivityRow    = typeof planActivity.$inferSelect;
export type NewPlanActivityRow = typeof planActivity.$inferInsert;

/**
 * WHO caused a plan write — the `actor` column on plan_activity and post_edits (0090).
 *
 * One vocabulary across both tables, and across the app, the worker and admin, because the
 * measurement it exists for (the untouched-post rate) has to compare like with like:
 *
 *   'client'    a magic-link session. The client's own hand on their own month.
 *   'operator'  us, editing on their behalf. Admitted by the CHECK and by this type; NO write
 *               path produces it yet, because admin is read-only over both tables today. It
 *               is here so the first operator edit surface has somewhere honest to land
 *               rather than borrowing 'client' and quietly corrupting the rate.
 *   'agent'     the system: the approval fan-out, the daily sweep, an approved proposal,
 *               a weekly-session rewrite. Nobody asked in the moment.
 *
 * Nullable everywhere. A row with no actor predates 0090 and means "not attributed" — never
 * "the client did it".
 */
export type PlanActor = 'client' | 'operator' | 'agent';
export const PLAN_ACTORS: readonly PlanActor[] = ['client', 'operator', 'agent'];

// ─── ui_events ────────────────────────────────────────────────────────────────
// Minimal product telemetry for the plan surface (redesign Stage 5, migration 0069).
// Deliberately SEPARATE from plan_activity: plan_activity is the plan-mutation ledger
// (what changed, by whom); ui_events is analytics (what the client did in the UI —
// view switches, approvals, agent asks, step ticks, shape requests). Append-only by
// use; not trigger-enforced (it isn't a source of truth).
export const uiEvents = pgTable(
  'ui_events',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    clientId:  uuid('client_id').notNull().references(() => clients.id),
    event:     text('event').notNull(),
    payload:   jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientCreatedIdx: index('ui_events_client_created_idx').on(t.clientId, t.createdAt),
  }),
);
export type UiEventRow    = typeof uiEvents.$inferSelect;
export type NewUiEventRow = typeof uiEvents.$inferInsert;

// ─── hook_patterns ────────────────────────────────────────────────────────────
// Structural-template library for hook generation (migration 0070). `pattern` keeps
// {slot} placeholders — the generation prompt shows the model the STRUCTURE, never the
// example's content. Selection reads active=true only (retiring = an UPDATE, not deploy).
export const hookPatterns = pgTable(
  'hook_patterns',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    name:      text('name').notNull(),
    category:  text('category').notNull(),
    pattern:   text('pattern').notNull(),
    example:   text('example').notNull(),
    formats:   text('formats').array().notNull().default([]),
    active:    boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('hook_patterns_active_idx').on(t.active),
  }),
);
export type HookPatternRow    = typeof hookPatterns.$inferSelect;
export type NewHookPatternRow = typeof hookPatterns.$inferInsert;
