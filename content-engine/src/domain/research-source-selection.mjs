export function allCapturedSourceIds(sources) {
  return (Array.isArray(sources) ? sources : []).filter((source) => source?.status === 'CAPTURED' && source?.id).map((source) => source.id);
}

export function initialSourceSelection(sources) {
  return (Array.isArray(sources) ? sources : []).filter((source) => source?.status === 'CAPTURED' && source?.selected === true && source?.id).map((source) => source.id);
}

export function toggleSourceSelection(selectedIds, sources, sourceId) {
  const captured = new Set(allCapturedSourceIds(sources));
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter((id) => captured.has(id)));
  if (!captured.has(sourceId)) return [...selected];
  if (selected.has(sourceId)) selected.delete(sourceId);
  else selected.add(sourceId);
  return [...selected];
}
