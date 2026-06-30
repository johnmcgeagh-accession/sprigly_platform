import type { LogicalModelName } from '@sprigly/model-client';

export type { LogicalModelName };

export interface WorkflowStepMeta {
  stepName: string;
  stepDescription: string;
  model: LogicalModelName;
  usesTools?: string[];
  requiresPrompt: boolean;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  /**
   * Default destinations used when a routing rule's destinations array is empty ([]).
   * Routing rules can override this by specifying a non-empty destinations array.
   *
   * Dynamic value resolution in settings:
   *   settings.to = "sender"  →  resolves to event.reply.data['from'] at delivery time.
   *                               Use this to reply to whoever triggered the workflow.
   *   Any other string         →  used as a literal value (e.g. a fixed email address).
   */
  defaultDestinations: Array<{
    destinationId: string;
    requireApproval?: boolean;
    settings: Record<string, unknown>;
  }>;
  steps: WorkflowStepMeta[];
}

export const workflowMeta: WorkflowMeta[] = [
  {
    id: 'sprigly-prospect-research',
    name: 'Prospect Research',
    description: 'Researches a prospect firm and identifies where AI can save time, producing a structured briefing for a discovery call.',
    defaultDestinations: [
      { destinationId: 'db-save-output', requireApproval: false, settings: {} },
      {
        destinationId: 'gmail-reply-with-attachment',
        requireApproval: false,
        settings: {
          to: { mode: 'sender' },
          subjectTemplate: 'Prospect brief: {{brandName}}',
          bodyTemplate:
            'Prospect brief ready: {{brandName}}\n\n' +
            '- What they do: {{summaryBullet1}}\n' +
            '- Top pipeline: {{summaryBullet2}}\n' +
            '- Key risk: {{summaryBullet3}}\n\n' +
            'PDF attached.',
          attachmentFilenameTemplate: '{{brandName}}-prospect-brief.pdf',
        },
      },
    ],
    steps: [
      {
        stepName: 'research',
        stepDescription: 'Searches the web for the firm and synthesises grounded intelligence: founder, ops tells, pain points.',
        model: 'sonnet',
        usesTools: ['web_search'],
        requiresPrompt: true,
      },
      {
        stepName: 'write',
        stepDescription: 'Shapes the raw research into a structured ProspectBriefData JSON document in Sprigly voice.',
        model: 'sonnet',
        requiresPrompt: true,
      },
      {
        stepName: 'render-pdf',
        stepDescription: 'Renders the structured data into a 7-page prospect brief PDF.',
        model: 'none' as LogicalModelName,
        requiresPrompt: false,
      },
    ],
  },
  {
    id: 'sprigly-blog-post',
    name: 'Blog Post',
    description: 'Generates a full SEO blog post from a topic brief.',
    defaultDestinations: [
      { destinationId: 'db-save-blog-post', requireApproval: false, settings: {} },
    ],
    steps: [
      {
        stepName: 'research',
        stepDescription: 'Researches angles, FAQ, and target keyword for the topic.',
        model: 'haiku',
        requiresPrompt: true,
      },
      {
        stepName: 'structure',
        stepDescription: 'Generates title, outline, excerpt, meta description, and CTA.',
        model: 'haiku',
        requiresPrompt: true,
      },
      {
        stepName: 'write',
        stepDescription: 'Writes the full blog post body using the research and structure.',
        model: 'haiku',
        requiresPrompt: true,
      },
    ],
  },
  {
    id: 'sprigly-inbox-triage',
    name: 'Inbox Triage',
    description: 'Classifies incoming emails and decides the appropriate action (draft reply, escalate, label, or invoke a workflow).',
    defaultDestinations: [
      { destinationId: 'db-save-output', requireApproval: false, settings: {} },
    ],
    steps: [
      {
        stepName: 'classify',
        stepDescription: 'Reads the email and returns a category, action, and optional draft reply.',
        model: 'sonnet',
        requiresPrompt: true,
      },
    ],
  },
  {
    id: 'sprigly-question-answerer',
    name: 'Question Answerer',
    description: 'Answers customer questions from the client\'s knowledge bank, in their voice, as a Gmail draft for human review.',
    defaultDestinations: [
      { destinationId: 'db-save-output', requireApproval: false, settings: {} },
    ],
    steps: [
      {
        stepName: 'reformulate',
        stepDescription: 'Strips the raw email to a clean question and maps it to a knowledge topic.',
        model: 'sonnet',
        requiresPrompt: true,
      },
      {
        stepName: 'compose',
        stepDescription: 'Drafts a reply grounded strictly in retrieved knowledge chunks.',
        model: 'sonnet',
        requiresPrompt: true,
      },
    ],
  },
  {
    // Full-mode catch-all. No model calls, no sends. Replaced by the triage
    // agent when inbox intelligence is configured (see BACKLOG: inbox-agent phase).
    id: 'sprigly-inbox-noop',
    name: 'Inbox (no-op)',
    description: 'Full-mode default workflow. Records that an email was seen and marks it processed. Makes no model calls, sends nothing, takes no irreversible action.',
    defaultDestinations: [
      { destinationId: 'db-save-output', requireApproval: false, settings: {} },
    ],
    steps: [],
  },
  {
    id: 'sprigly-meeting-prep',
    name: 'Meeting Prep',
    description: 'TODO: describe what this workflow produces.',
    defaultDestinations: [
      { destinationId: 'db-save-output', requireApproval: false, settings: {} },
    ],
    steps: [
      { stepName: 'generate', stepDescription: 'TODO: describe this step.', model: 'sonnet', requiresPrompt: true },
    ],
  },
  {
    id: 'content-cycle-request-email',
    name: 'Content Cycle: Request Email',
    description: 'Monthly content-request pipeline: trawl Instagram posts then build and send the request-email draft.',
    defaultDestinations: [],
    steps: [
      {
        stepName: 'trawl',
        stepDescription: 'Fetches last-month Instagram posts via Apify and writes instagram-posts-YYYY-MM.json to Drive.',
        model: 'none' as LogicalModelName,
        requiresPrompt: false,
      },
      {
        stepName: 'lean-line',
        stepDescription: 'Generates a 1–2 sentence content recommendation from top sellers and top posts.',
        model: 'haiku',
        requiresPrompt: true,
      },
    ],
  },
  {
    id: 'sprigly-calendar-build-workbook',
    name: 'Calendar Build Workbook',
    description: 'Deterministic: CSV + calendar-config.json → 3-tab xlsx via generate_calendar.py; delivered by email. Zero LLM calls.',
    defaultDestinations: [
      {
        destinationId: 'gmail-reply-with-attachment',
        requireApproval: false,
        settings: {
          to: { mode: 'sender' },
          subjectTemplate: 'Content calendar ready — {{month}} {{year}}',
          bodyTemplate: "Hi,\n\nYour Sprigly content calendar for {{month}} {{year}} is attached.\n\nBest,\nSprigly",
          attachmentFilenameTemplate: '{{filename}}',
          attachmentMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          attachmentDataKey: 'xlsx',
        },
      },
    ],
    steps: [],
  },
  {
    id: 'planning',
    name: 'Content Cycle: Planning',
    description: 'Monthly content-plan generation: a single Bedrock call produces the briefed plan, then a per-post LLM critic validates voice/sign-off/pillar consistency against the client\'s own voice.md and historic posts.',
    defaultDestinations: [],
    steps: [
      {
        stepName: 'generate-plan',
        stepDescription: 'Generates the full month of briefed posts (captions, pillars, formats, competitor insight) as structured rows, in the client\'s voice.',
        model: 'sonnet',
        requiresPrompt: true,
      },
      {
        stepName: 'validate-plan',
        stepDescription: 'Per-post critic: judges voice/tone, sign-off discipline and pillar-voice consistency against the client\'s voice.md + config + historic posts. Fails regenerate.',
        model: 'sonnet',
        requiresPrompt: true,
      },
    ],
  },
];
