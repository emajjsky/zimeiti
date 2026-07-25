const trackingParameters = new Set(['spm', 'from', 'source', 'ref', 'ref_src', 'fbclid', 'gclid', 'share_token']);

function normalizeCanonicalUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    const parameters = [...url.searchParams.entries()]
      .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !trackingParameters.has(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = '';
    for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);
    return url.toString();
  } catch {
    return null;
  }
}

module.exports = { normalizeCanonicalUrl };
