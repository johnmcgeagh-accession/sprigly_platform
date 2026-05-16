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
      { destinationId: 'gmail-reply-prospect-brief', requireApproval: false, settings: { to: 'sender' } },
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
];
