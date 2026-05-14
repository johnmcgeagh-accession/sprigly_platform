export interface BlogPostInput {
  topic: string;
}

export interface BlogPostOutput {
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  metaDescription: string;
  targetKeyword: string;
  category: string;
  author: string;
  cta: string;
  researchNotes: string;
  faq: Array<{ question: string; answer: string }>;
  topic: string;
}

export interface ResearchResponse {
  targetKeyword: string;
  angles: string[];
  faq: Array<{ question: string; answer: string }>;
  researchNotes: string;
}

export interface StructureResponse {
  title: string;
  excerpt: string;
  metaDescription: string;
  category: string;
  cta: string;
}
