import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const serverSource = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');

function functionSource(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const next = serverSource.indexOf('\nfunction ', start + 1);
  assert.notEqual(next, -1, `missing function boundary after ${name}`);
  return serverSource.slice(start, next).trim();
}

function optionalFunctionSource(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = serverSource.indexOf('\nfunction ', start + 1);
  return serverSource.slice(start, next < 0 ? undefined : next).trim();
}

const context = {};
vm.runInNewContext([
  functionSource('classifyModelCapabilities'),
  functionSource('classifyModelOperations'),
  functionSource('modelCatalogItem'),
  optionalFunctionSource('normalizeCatalogItem'),
  functionSource('catalogSupportsTask'),
  'globalThis.classifyModelCapabilities = classifyModelCapabilities;',
  'globalThis.modelCatalogItem = modelCatalogItem;',
  'globalThis.normalizeCatalogItem = typeof normalizeCatalogItem === "function" ? normalizeCatalogItem : undefined;',
  'globalThis.catalogSupportsTask = catalogSupportsTask;',
].join('\n'), context);

test('Qwen 3.6 至 3.8 的本地多模态能力不会被旧目录 TEXT 标签覆盖', () => {
  for (const model of ['qwen3.6-plus', 'qwen3.7-max', 'qwen3.8-max']) {
    const item = context.modelCatalogItem({
      provider: 'BAILIAN_CLI',
      connectionLabel: '百炼',
      model,
      capabilities: ['TEXT'],
    });
    assert.deepEqual(
      [...item.capabilities].sort(),
      ['IMAGE', 'MULTIMODAL', 'TEXT', 'VIDEO', 'VISION'].sort(),
      model,
    );
  }
});

test('普通文本模型不会被误标为多模态模型', () => {
  const item = context.modelCatalogItem({
    provider: 'BAILIAN_CLI',
    connectionLabel: '百炼',
    model: 'qwen-plus',
    capabilities: ['TEXT'],
  });
  assert.deepEqual(Array.from(item.capabilities), ['TEXT']);
});

test('读取旧模型目录时重新合并当前本地能力分类', () => {
  assert.equal(typeof context.normalizeCatalogItem, 'function');
  const item = context.normalizeCatalogItem({
    id: 'bailian:qwen3.7-plus',
    provider: 'BAILIAN_CLI',
    connectionLabel: '百炼',
    model: 'qwen3.7-plus',
    capabilities: ['TEXT'],
    operations: [],
    origin: 'ACCOUNT_CATALOG',
  });
  assert.deepEqual(
    [...item.capabilities].sort(),
    ['IMAGE', 'MULTIMODAL', 'TEXT', 'VIDEO', 'VISION'].sort(),
  );
});

test('富内容解读任务只接受百炼多模态模型', () => {
  const multimodal = context.modelCatalogItem({ provider: 'BAILIAN_CLI', connectionLabel: '百炼', model: 'qwen3.7-plus' });
  const textOnly = context.modelCatalogItem({ provider: 'BAILIAN_CLI', connectionLabel: '百炼', model: 'deepseek-v3' });
  const external = context.modelCatalogItem({ provider: 'EXTERNAL_API', connectionId: 'external-1', connectionLabel: '外部 API', model: 'qwen3.7-plus' });
  const tasks = [
    'INTELLIGENCE_ANALYSIS',
    'TITLE_RECOMMENDATION',
    'VOICE_CALIBRATION',
    'WECHAT_VISUAL_PLANNING',
    'WECHAT_TEMPLATE_ANALYSIS',
    'CONTENT_UNDERSTANDING',
    'VIDEO_ANALYSIS',
  ];
  for (const task of tasks) {
    assert.equal(context.catalogSupportsTask(multimodal, task), true, task);
    assert.equal(context.catalogSupportsTask(textOnly, task), false, task);
    assert.equal(context.catalogSupportsTask(external, task), false, task);
  }
});

test('视频拉片只接受 Qwen 3.6 至 3.8，Omni 不进入候选', () => {
  for (const model of ['qwen3.6-plus', 'qwen3.7-max', 'qwen3.8-max']) {
    assert.equal(context.catalogSupportsTask(context.modelCatalogItem({ provider: 'BAILIAN_CLI', model }), 'VIDEO_ANALYSIS'), true, model);
  }
  assert.equal(context.catalogSupportsTask(context.modelCatalogItem({ provider: 'BAILIAN_CLI', model: 'qwen3.5-omni-plus' }), 'VIDEO_ANALYSIS'), false);
  assert.equal(context.catalogSupportsTask(context.modelCatalogItem({ provider: 'BAILIAN_CLI', model: 'qwen3.7-text-embedding' }), 'VIDEO_ANALYSIS'), false);
});
