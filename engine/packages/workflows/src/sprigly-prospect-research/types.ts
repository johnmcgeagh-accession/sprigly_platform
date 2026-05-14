export interface ProspectInput {
  brandName: string;
  sector: string;
  url?: string;
  notes?: string;
}

export interface AiUseCase {
  useCase: string;
  estimatedHoursSaved: string;
  difficulty: 'quick-win' | 'medium' | 'complex';
}

export interface ProspectOutput {
  brandName: string;
  sector: string;
  painPoints: string[];
  aiUseCases: AiUseCase[];
  recommendedFirstStep: string;
  callTalkingPoints: string[];
}
