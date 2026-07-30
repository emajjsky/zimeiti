import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('配图搜索优先复用已配置的 Tavily 图片能力并保留版权提醒', () => {
  const service = fs.readFileSync(new URL('../server/services/tavily.cjs', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(service, /include_images: true/);
  assert.match(service, /include_image_descriptions: true/);
  assert.match(service, /使用前确认版权与授权/);
  assert.match(api, /searchTavilyImages\(workspace\.id, input\.q\)/);
  assert.match(api, /Promise\.any\(searches\)/);
  assert.match(api, /开放图库连接失败/);
});
