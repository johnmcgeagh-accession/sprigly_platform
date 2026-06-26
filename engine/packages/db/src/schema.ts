import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
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
  costPence: integer('cost_pence'),
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
    contentCycleSchedule: jsonb('content_cycle_schedule').$type<{ day: number; hour: number } | null>(),
    extraQuestions:       jsonb('extra_questions').$type<string[] | null>(),
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
    requestSentAt:     timestamp('request_sent_at'),
    remindedAt:        timestamp('reminded_at'),
    replyReceivedAt:   timestamp('reply_received_at'),
    deliveredAt:       timestamp('delivered_at'),
    finalisedAt:       timestamp('finalised_at'),
    voiceMergedAt:     timestamp('voice_merged_at'),
    closedAt:          timestamp('closed_at'),
    failedStep:        text('failed_step'),
  },
  (t) => ({
    uniqClientChannelMonth: uniqueIndex('content_cycles_unique').on(
      t.clientId, t.channel, t.cycleMonth,
    ),
  }),
);

export type ContentCycle    = typeof contentCycles.$inferSelect;
export type NewContentCycle = typeof contentCycles.$inferInsert;
