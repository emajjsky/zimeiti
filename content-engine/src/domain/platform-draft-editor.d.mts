export type EditableDraftAsset = {
  assetId: string;
  role: 'COVER' | 'BODY';
};
export type DraftAssetInput = {
  assetId: string;
  role: 'COVER' | 'BODY' | 'CARD' | 'MAIN';
};

export type DraftSourceState = 'CURRENT' | 'STALE' | 'MISSING';

export const PLATFORM_DRAFT_IMAGE_LIMIT: 9;
export function normalizeDraftAssets(assets: DraftAssetInput[]): EditableDraftAsset[];
export function moveDraftAsset(assets: DraftAssetInput[], index: number, offset: number): EditableDraftAsset[];
export function removeDraftAsset(assets: DraftAssetInput[], index: number): EditableDraftAsset[];
export function draftSourceState(
  draft: { sourceDraftVersionId: string | null; sourceStale: boolean },
  currentSourceVersionId: string | null,
): DraftSourceState;
