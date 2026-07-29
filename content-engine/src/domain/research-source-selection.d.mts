export type ResearchSourceSelectionItem = { id?: string; status?: string; selected?: boolean };

export function allCapturedSourceIds(sources: ResearchSourceSelectionItem[]): string[];
export function initialSourceSelection(sources: ResearchSourceSelectionItem[]): string[];
export function toggleSourceSelection(selectedIds: string[], sources: ResearchSourceSelectionItem[], sourceId: string): string[];
