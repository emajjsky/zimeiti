const { isIP } = require('node:net');

const IP_CHECK_URLS = Object.freeze([
  'https://ipv4.icanhazip.com',
  'https://4.ident.me',
  'https://ipinfo.io/ip',
]);

function normalizeIpv4(value) {
  const ip = String(value ?? '').trim();
  return isIP(ip) === 4 ? ip : null;
}

async function readPublicIpv4(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`出口 IP 服务返回 HTTP ${response.status}`);
  const ipv4 = normalizeIpv4(await response.text());
  if (!ipv4) throw new Error('出口 IP 服务没有返回有效 IPv4 地址');
  return { url, ipv4 };
}

async function detectPublicIpv4({ fetchImpl = fetch, urls = IP_CHECK_URLS } = {}) {
  const results = await Promise.allSettled(urls.map((url) => readPublicIpv4(url, fetchImpl)));
  const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!successful.length) throw new Error('无法检测服务器公网 IPv4，请检查服务器网络后重试。');
  const addresses = [...new Set(successful.map(({ ipv4 }) => ipv4))];
  if (addresses.length > 1) throw new Error(`出口 IP 检测结果不一致：${addresses.join('、')}。请检查服务器代理或 NAT 配置。`);
  return { ipv4: addresses[0], checkedAt: new Date().toISOString(), sources: successful.map(({ url }) => url) };
}

module.exports = { IP_CHECK_URLS, detectPublicIpv4, normalizeIpv4 };
