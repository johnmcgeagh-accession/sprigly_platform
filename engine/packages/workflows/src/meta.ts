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
   * Default destination used when a routing rule's destinations array is empty ([]).
   * Routing rules can override this by specifying a non-empty destinations array.
   *
   * Dynamic value resolution in settings:
   *   settings.to = "sender"  →  resolves to event.reply.data['from'] at delivery time.
   *                               Use this to reply to whoever triggered the workflow.
   *   Any other string         →  used as a literal value (e.g. a fixed email address).
   */
  defaultDestination: {
    destinationId: string;
    requireApproval?: boolean;
    settings: Record<string, unknown>;
  };
  steps: WorkflowStepMeta[];
}

export const workflowMeta: WorkflowMeta[] = [
  {
    id: 'sprigly-prospect-research',
    name: 'Prospect Research',
    description: 'Researches a prospect firm and identifies where AI can save time, producing a structured briefing for a discovery call.',
    defaultDestination: {
      destinationId: 'db-save-output',
      requireApproval: true,
      settings: {},
    },
    steps: [
      {
        stepName: 'research',
        stepDescription: 'Analyses the firm, identifies pain points, and generates AI use cases with estimated time savings.',
        model: 'haiku',
        requiresPrompt: false,
      },
    ],
  },
  {
    id: 'sprigly-blog-post',
    name: 'Blog Post',
    description: 'Generates a full SEO blog post from a topic brief.',
    defaultDestination: {
      destinationId: 'db-save-blog-post',
      requireApproval: false,
      settings: {},
    },
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
