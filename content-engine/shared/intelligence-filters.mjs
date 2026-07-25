export function matchesIntelligenceQuery(item, query) {
  const normalized = String(query ?? '').trim().toLocaleLowerCase();
  if (!normalized) return true;
  const searchable = [item?.title, item?.summary, item?.source, ...(item?.keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return searchable.includes(normalized);
}
