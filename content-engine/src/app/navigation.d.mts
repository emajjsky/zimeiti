export type View =
  | 'today'
  | 'discover'
  | 'plan'
  | 'topicEditor'
  | 'create'
  | 'publish'
  | 'review'
  | 'assets'
  | 'settings';

export type DiscoverSection = 'inbox' | 'search' | 'import';

export type SettingsSection =
  | 'workspace'
  | 'sources'
  | 'models'
  | 'feishu'
  | 'accounts';

export type ModelSection = 'bailian' | 'agent' | 'search' | 'connections' | 'policies' | 'usage';

export interface SearchPreset {
  label: string;
  domains: string[];
  defaultCategory?: string;
}

export interface NavigationItem {
  view: Exclude<View, 'topicEditor'>;
  label: string;
}

export interface NavigationGroup {
  id: 'work' | 'resources' | 'system';
  label: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[];
export const discoverTabs: { id: DiscoverSection; label: string }[];
export const settingsTabs: { id: SettingsSection; label: string }[];

export function discoverIntent(
  discoverSection?: DiscoverSection,
  searchPreset?: SearchPreset | null,
): {
  view: 'discover';
  discoverSection: DiscoverSection;
  searchPreset: SearchPreset | null;
};

export function settingsIntent(
  settingsSection?: SettingsSection,
  modelSection?: ModelSection | null,
): {
  view: 'settings';
  settingsSection: SettingsSection;
  modelSection: ModelSection | null;
};

export interface ViewportScrollTarget {
  scrollTo(options: ScrollToOptions): void;
}

export function resetViewport(scrollTarget?: ViewportScrollTarget): void;
