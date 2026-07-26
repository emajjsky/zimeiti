export function matchesIntelligenceQuery(item, query) {
  const normalized = String(query ?? '').trim().toLocaleLowerCase();
  if (!normalized) return true;
  const searchable = [item?.title, item?.summary, item?.source, ...(item?.keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return searchable.includes(normalized);
}

export function intelligenceSourceLabel(item) {
  if (item?.captureMethod === 'SEARCH') return '网页检索';
  if (item?.captureMethod === 'MANUAL_LINK') return String(item?.source ?? '').trim() || '导入链接';
  return String(item?.source ?? '').trim();
}

function intelligenceLanguage(item) {
  if (item?.language) return String(item.language).toLocaleLowerCase();
  const text = `${item?.title ?? ''} ${item?.summary ?? ''}`;
  return /[\u3400-\u9fff]/.test(text) ? 'zh' : /[a-z]/i.test(text) ? 'en' : 'other';
}

export function filterIntelligenceItems(items, filters, now = Date.now()) {
  const rangeMilliseconds = {
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000,
  }[filters.timeRange] ?? 30 * 24 * 60 * 60 * 1000;
  const selectedSource = String(filters.source ?? 'ALL').trim();

  return items.filter((item) => {
    const timestamp = item.publishedAt === '刚刚' ? now : new Date(item.publishedAt).valueOf();
    const isWithinRange = !Number.isFinite(timestamp) || timestamp >= now - rangeMilliseconds;
    const sourceMatches = selectedSource === 'ALL' || intelligenceSourceLabel(item) === selectedSource;
    const categoryMatches = filters.category === 'ALL' || item.category === filters.category;
    const languageMatches = filters.language === 'ALL' || intelligenceLanguage(item) === String(filters.language).toLocaleLowerCase();
    return isWithinRange && sourceMatches && categoryMatches && languageMatches && matchesIntelligenceQuery(item, filters.query);
  });
}
