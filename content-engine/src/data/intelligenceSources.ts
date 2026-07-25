import sourceCatalog from '../../shared/intelligence-sources.json';
import taxonomy from '../../shared/intelligence-taxonomy.json';
import type { IntelligenceSource } from '../domain/content';

type SourceDraft = Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>;
type RawSource = Pick<SourceDraft, 'name' | 'url' | 'category' | 'language'>;

export interface AssistedChannel {
  id: 'WEIBO' | 'TOUTIAO' | 'CCTV' | 'X' | 'WECHAT';
  label: string;
  domains: string[];
  supportsClip: boolean;
  supportsSearch: boolean;
}

export interface AutomaticSourceGroup {
  id: string;
  label: string;
  sources: SourceDraft[];
}

const toSourceDraft = (source: RawSource): SourceDraft => ({
  ...source,
  type: 'RSS',
  enabled: true,
  refreshMinutes: 60,
  trust: '待核验',
});

export const automaticSourceGroups: AutomaticSourceGroup[] = sourceCatalog.automatic.map((group) => ({
  ...group,
  sources: group.sources.map((source) => toSourceDraft(source as RawSource)),
}));

export const assistedChannels = sourceCatalog.assisted as AssistedChannel[];
export const intelligenceCategories = taxonomy.categories.map((category) => category.id);
