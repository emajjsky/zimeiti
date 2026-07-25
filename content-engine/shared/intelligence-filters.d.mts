export interface SearchableIntelligence {
  title: string;
  summary: string;
  source: string;
  keywords?: string[];
}

export function matchesIntelligenceQuery(item: SearchableIntelligence, query: string): boolean;
