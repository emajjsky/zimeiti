export interface SearchableIntelligence {
  title: string;
  summary: string;
  source: string;
  keywords?: string[];
}

export function matchesIntelligenceQuery(item: SearchableIntelligence, query: string): boolean;

export interface FilterableIntelligence extends SearchableIntelligence {
  category: string;
  publishedAt: string;
  captureMethod?: 'RSS' | 'MANUAL_LINK' | 'SEARCH';
  language?: 'zh' | 'en' | 'other';
}

export interface IntelligenceFilters {
  source: string;
  category: string;
  language: string;
  timeRange: 'DAY' | 'WEEK' | 'MONTH';
  query: string;
}

export function intelligenceSourceLabel(item: FilterableIntelligence): string;
export function filterIntelligenceItems<T extends FilterableIntelligence>(items: T[], filters: IntelligenceFilters, now?: number): T[];
