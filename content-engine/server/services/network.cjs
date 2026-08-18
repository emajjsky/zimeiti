const { execFileSync } = require('node:child_process');
const { ProxyAgent } = require('undici');

let cachedProxyUrl;
let cachedDispatcher;

function configuredProxyUrl() {
  const environmentProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (environmentProxy) return environmentProxy;
  if (process.platform !== 'win32') return '';
  try {
    const enabled = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) return '';
    const server = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true }).match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    if (!server) return '';
    const entries = server.split(';');
    const proxy = entries.find((item) => /^https=/i.test(item))?.split('=').slice(1).join('=') || entries.find((item) => /^http=/i.test(item))?.split('=').slice(1).join('=') || server;
    return /^https?:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
  } catch {
    return '';
  }
}

function externalFetch(input, options = {}) {
  const proxyUrl = cachedProxyUrl ??= configuredProxyUrl();
  if (!proxyUrl) return fetch(input, options);
  cachedDispatcher ??= new ProxyAgent(proxyUrl);
  return fetch(input, { ...options, dispatcher: options.dispatcher ?? cachedDispatcher });
}

module.exports = { configuredProxyUrl, externalFetch };
