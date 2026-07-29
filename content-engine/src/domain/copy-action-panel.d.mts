export type CopyPanelAction =
  | 'GENERATE_OUTLINE'
  | 'GENERATE_DRAFT'
  | 'REVISE_SELECTION'
  | 'POLISH_EXISTING_DRAFT'
  | 'EXPAND_DRAFT'
  | 'SHORTEN_DRAFT'
  | 'RESTRUCTURE_DRAFT';

export type CopyPanelPrimaryAction = CopyPanelAction | 'REVIEW_CANDIDATE';

export type CopyActionPanelState = {
  primary: { action: CopyPanelPrimaryAction; label: string };
  quickActions: Array<{ action: Extract<CopyPanelAction, 'POLISH_EXISTING_DRAFT' | 'EXPAND_DRAFT' | 'SHORTEN_DRAFT' | 'RESTRUCTURE_DRAFT'>; label: string }>;
};

export function copyActionRequest(action: CopyPanelAction, note?: string): string;
export function copyActionPanelState(input: { hasBody: boolean; hasSelection: boolean; hasCandidate: boolean }): CopyActionPanelState;
