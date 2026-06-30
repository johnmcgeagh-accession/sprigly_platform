export const WEB_SEARCH_TOOL_DEFINITION = {
  name: 'web_search',
  description: 'Search the web for information about a company, person, or topic.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'A short, specific search query (1-6 words). Use source-specific terms like ' +
          '"site:linkedin.com" when appropriate. Do not repeat a query you have already used.',
      },
    },
    required: ['query'],
  },
} as const;
