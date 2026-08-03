const PLATFORM_DRAFT_IMAGE_LIMIT = 9;

function orderedAssets(assets) {
  return assets.map(({ assetId }, index) => ({
    assetId,
    role: index === 0 ? 'COVER' : 'BODY',
  }));
}

export function normalizeDraftAssets(assets) {
  if (!Array.isArray(assets)) throw new TypeError('平台草稿素材必须是数组。');
  if (assets.length > PLATFORM_DRAFT_IMAGE_LIMIT) throw new Error(`平台草稿最多允许 ${PLATFORM_DRAFT_IMAGE_LIMIT} 张图片。`);
  const ids = assets.map(({ assetId }) => String(assetId ?? '').trim());
  if (ids.some((assetId) => !assetId)) throw new Error('平台草稿素材缺少素材 ID。');
  if (new Set(ids).size !== ids.length) throw new Error('平台草稿不能重复使用同一张素材。');
  return orderedAssets(ids.map((assetId) => ({ assetId })));
}

export function moveDraftAsset(assets, index, offset) {
  const normalized = normalizeDraftAssets(assets);
  const target = index + offset;
  if (!Number.isInteger(index) || !Number.isInteger(offset) || index < 0 || index >= normalized.length || target < 0 || target >= normalized.length) return normalized;
  const next = [...normalized];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return orderedAssets(next);
}

export function removeDraftAsset(assets, index) {
  const normalized = normalizeDraftAssets(assets);
  if (!Number.isInteger(index) || index < 0 || index >= normalized.length) return normalized;
  return orderedAssets(normalized.filter((_, assetIndex) => assetIndex !== index));
}

export function draftSourceState(draft, currentSourceVersionId) {
  if (!draft?.sourceDraftVersionId || !currentSourceVersionId) return 'MISSING';
  if (draft.sourceStale || draft.sourceDraftVersionId !== currentSourceVersionId) return 'STALE';
  return 'CURRENT';
}

export { PLATFORM_DRAFT_IMAGE_LIMIT };
