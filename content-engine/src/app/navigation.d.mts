export type View =
  | 'today'
  | 'discover'
  | 'create'
  | 'publish'
  | 'review'
  | 'assets'
  | 'settings';

export type CreateStageRoute = 'preparation' | 'copy' | 'visual' | 'layout' | 'drafts';

export type DiscoverSection = 'inbox' | 'search' | 'import';

export type SettingsSection =
  | 'workspace'
  | 'sources'
  | 'voices'
  | 'models'
  | 'feishu'
  | 'accounts';

export type ModelSection = 'bailian' | 'agent' | 'search' | 'connections' | 'policies' | 'templates' | 'usage';

export interface SearchPreset {
  label: string;
  domains: string[];
  defaultCategory?: string;
}

export interface NavigationItem {
  view: View;
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

export interface WorkspaceLocationState {
  view: View;
  discoverSection: DiscoverSection;
  settingsSection: SettingsSection;
  modelSection: ModelSection | null;
  intelligenceId: string | null;
  legacyTopicId: string | null;
  projectId: string | null;
  stage: CreateStageRoute | null;
  draftId: string | null;
}

export interface WorkspaceLocationTarget {
  href?: string;
  search?: string;
}

export interface WorkspaceHistoryTarget {
  state?: unknown;
  replaceState(state: unknown, unused: string, url?: string | URL | null): void;
}

export function readWorkspaceLocation(locationTarget?: WorkspaceLocationTarget): WorkspaceLocationState;
export function workspaceLocationUrl(route: WorkspaceLocationState, locationTarget?: WorkspaceLocationTarget): string;
export function replaceWorkspaceLocation(route: WorkspaceLocationState, historyTarget?: WorkspaceHistoryTarget, locationTarget?: WorkspaceLocationTarget): void;
