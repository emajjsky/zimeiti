function plainMetadata(value, maxLength = 300) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeImageSearchResult(result, defaults = {}) {
  const imageUrl = String(result?.imageUrl ?? '').trim();
  const thumbnailUrl = String(result?.thumbnailUrl ?? imageUrl).trim();
  const sourceUrl = String(result?.sourceUrl ?? imageUrl).trim();
  if (![imageUrl, thumbnailUrl, sourceUrl].every((url) => /^https?:\/\//i.test(url) && url.length <= 2_000)) return null;
  return {
    id: plainMetadata(result?.id, 160),
    title: plainMetadata(result?.title || defaults.title || '网页候选图', 200),
    thumbnailUrl,
    imageUrl,
    sourceUrl,
    license: plainMetadata(result?.license || defaults.license || '使用前确认版权与授权', 300),
    attribution: plainMetadata(result?.attribution || defaults.attribution || '网页图片检索', 300),
    copyrightStatus: result?.copyrightStatus === 'OPEN_LICENSE' ? 'OPEN_LICENSE' : 'PENDING',
  };
}

function normalizeImageSearchResults(results, defaults) {
  return (Array.isArray(results) ? results : []).flatMap((result) => {
    const normalized = normalizeImageSearchResult(result, defaults);
    return normalized?.id && normalized.title ? [normalized] : [];
  }).slice(0, 12);
}

async function searchImagesWithFallback(queryText, { searchPrimary, searchFallback }) {
  const errors = [];
  try {
    const results = normalizeImageSearchResults(await searchPrimary(queryText));
    if (results.length) return { provider: 'Tavily 图片搜索', results };
    errors.push('未配置 Tavily 或没有网页候选图');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const results = normalizeImageSearchResults(await searchFallback(queryText));
    if (results.length) return { provider: 'Wikimedia Commons', results };
    errors.push('开放图库没有匹配图片');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  throw new Error(`图片搜索暂时不可用：${errors.join('；')}。`);
}

async function searchWikimediaImages(queryText, fetchImpl = fetch) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6',
    gsrsearch: queryText, gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640', origin: '*',
  });
  let response;
  try {
    response = await fetchImpl(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    throw new Error(`开放图库连接失败（${error instanceof Error ? error.message : '网络错误'}）`);
  }
  if (!response.ok) throw new Error(`图片搜索服务返回 HTTP ${response.status}`);
  const payload = await response.json();
  const results = normalizeImageSearchResults((payload?.query?.pages ?? []).flatMap((page) => {
    const info = page?.imageinfo?.[0];
    if (!info?.url || !info?.thumburl) return [];
    const metadata = info.extmetadata ?? {};
    return [{
      id: String(page.pageid),
      title: String(page.title || 'Wikimedia Commons 图片').replace(/^File:/i, ''),
      thumbnailUrl: info.thumburl,
      imageUrl: info.url,
      sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
      license: plainMetadata(metadata.LicenseShortName?.value || metadata.UsageTerms?.value || '请查看来源页'),
      attribution: plainMetadata(metadata.Artist?.value || metadata.Credit?.value || 'Wikimedia Commons'),
      copyrightStatus: 'OPEN_LICENSE',
    }];
  }));
  if (!results.length) throw new Error('开放图库没有匹配图片');
  return results;
}

module.exports = { normalizeImageSearchResult, normalizeImageSearchResults, plainMetadata, searchImagesWithFallback, searchWikimediaImages };
