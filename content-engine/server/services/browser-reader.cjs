const { existsSync } = require('node:fs');

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function resolveChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate)) || null;
}

async function readWeChatArticleWithBrowser(rawUrl) {
  const requestedUrl = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  if (requestedUrl.hostname.toLowerCase() !== 'mp.weixin.qq.com' || !/^\/s\//i.test(requestedUrl.pathname)) {
    throw new Error('浏览器辅助读取仅支持公众号公开文章链接。');
  }
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error('服务器未检测到 Chrome。请配置 PLAYWRIGHT_CHROME_PATH，或改用粘贴正文导入。');
  }

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
  });
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (request.resourceType() === 'document' && target.hostname.toLowerCase() === 'mp.weixin.qq.com') await route.continue();
      else await route.abort();
    });
    await page.goto(requestedUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const finalUrl = new URL(page.url());
    if (finalUrl.hostname.toLowerCase() !== 'mp.weixin.qq.com') throw new Error('公众号文章跳转到了不受支持的网站。');
    const html = await page.content();
    if (Buffer.byteLength(html, 'utf8') > 5_000_000) throw new Error('公众号页面内容超过 5MB，无法导入。');
    return { url: finalUrl, html };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

module.exports = { readWeChatArticleWithBrowser, resolveChromeExecutable };
