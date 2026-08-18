import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { detectPublicIpv4, normalizeIpv4 } from '../server/services/public-egress-ip.cjs';

test('公网 IPv4 检测只接受一致的有效 IPv4', async () => {
  const result = await detectPublicIpv4({
    urls: ['https://one.example/ip', 'https://two.example/ip'],
    fetchImpl: async () => new Response('183.225.3.189\n'),
  });
  assert.equal(result.ipv4, '183.225.3.189');
  assert.equal(result.sources.length, 2);
  assert.equal(normalizeIpv4('::ffff:183.225.3.189'), null);
});

test('公网 IPv4 检测拒绝互相矛盾的出口地址', async () => {
  await assert.rejects(
    () => detectPublicIpv4({
      urls: ['https://one.example/ip', 'https://two.example/ip'],
      fetchImpl: async (url) => new Response(url.includes('one') ? '183.225.3.189' : '39.128.27.248'),
    }),
    /不一致/,
  );
});

test('账号授权页通过受保护接口展示服务器出口 IP 和微信配置入口', async () => {
  const [routes, api, settings] = await Promise.all([
    readFile(new URL('../server/routes/publishing.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/data/webApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/workspaces/settings/AccountAuthorizationSettings.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(routes, /official-network/);
  assert.match(routes, /forRole\('OWNER'\)/);
  assert.match(api, /officialNetwork/);
  assert.match(settings, /officialNetwork/);
  assert.match(settings, /developers\.weixin\.qq\.com/);
  assert.match(settings, /API IP 白名单/);
});
