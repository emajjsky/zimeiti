import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  COPY_ACTIONS,
  buildCopyPrompt,
  copyActionVersion,
  copyTemplateScope,
  defaultRevisionTemplate,
  parseCopyOutput,
  resolveCopyAction,
} from '../server/services/project-copy-action.cjs';

test('文案请求按固定优先级确定性映射到注册动作', () => {
  assert.equal(resolveCopyAction({ request: '把这篇文章润色一下', hasBody: true }).action, 'POLISH_EXISTING_DRAFT');
  assert.equal(resolveCopyAction({ request: '压缩到 800 字', hasBody: true }).action, 'SHORTEN_DRAFT');
  assert.equal(resolveCopyAction({ request: '改成微博串文', hasBody: true, targetPlatform: 'WEIBO' }).action, 'ADAPT_PLATFORM');
  assert.equal(resolveCopyAction({ request: '把选中的两段改得更清楚', hasBody: true, selection: '原文' }).action, 'REVISE_SELECTION');
  assert.equal(resolveCopyAction({ request: '扩写这篇内容', hasBody: true }).action, 'EXPAND_DRAFT');
  assert.equal(resolveCopyAction({ request: '重新调整文章结构', hasBody: true }).action, 'RESTRUCTURE_DRAFT');
  assert.equal(resolveCopyAction({ request: '先生成文章大纲', hasBody: false }).action, 'GENERATE_OUTLINE');
  assert.equal(resolveCopyAction({ request: '写一篇完整正文', hasBody: false }).action, 'GENERATE_DRAFT');
});

test('无法唯一判断的请求要求澄清且不创建动作', () => {
  assert.deepEqual(resolveCopyAction({ request: '处理一下', hasBody: true }), {
    needsClarification: true,
    question: '你希望润色、重构、扩写还是压缩当前文案？',
  });
  assert.deepEqual(resolveCopyAction({ request: '把这篇文章润色并压缩', hasBody: true }), {
    needsClarification: true,
    question: '这次要优先润色表达，还是压缩篇幅？',
  });
});

test('八个文案动作拥有稳定版本且模型输出保持待核验事实', () => {
  assert.equal(COPY_ACTIONS.length, 8);
  assert.equal(copyActionVersion('SHORTEN_DRAFT'), 'project-copy-shorten-draft:1.0.0');
  const output = parseCopyOutput(JSON.stringify({
    title: '调整后的标题',
    body: '这是调整后的完整正文。'.repeat(12),
    changeSummary: '压缩重复表达并保留核心观点。',
    factsToVerify: ['核验公开数据的发布日期'],
  }), 'SHORTEN_DRAFT');
  assert.deepEqual(output.factsToVerify, ['核验公开数据的发布日期']);
  assert.throws(() => parseCopyOutput(JSON.stringify({ ...output, factsToVerify: '已经核验' }), 'SHORTEN_DRAFT'), /array|expected/i);
});

test('四个平台拥有独立修订提示词 Scope 和规则', () => {
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']) {
    assert.equal(copyTemplateScope(platform), `CREATIVE_REVISION_${platform}`);
  }
  assert.match(defaultRevisionTemplate('WECHAT'), /公众号/);
  assert.match(defaultRevisionTemplate('XIAOHONGSHU'), /小红书/);
  assert.match(defaultRevisionTemplate('ZHIHU'), /知乎|论证/);
  assert.match(defaultRevisionTemplate('WEIBO'), /微博|单条|串文/);
});

test('文案提示词冻结动作、平台规则并禁止洗掉待核验事实', () => {
  const prompt = buildCopyPrompt({
    action: 'POLISH_EXISTING_DRAFT',
    request: '让表达更自然',
    platform: 'WECHAT',
    template: '保留作者的个人表达。',
    project: { title: '项目标题', coreViewpoint: '核心观点', factChecks: ['核验价格'] },
    brief: { objective: '完成文章', targetAudience: '普通读者', coreMessage: '先说明边界', sourceRequirements: '使用公开来源', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '原标题', body: '原正文', factsToVerify: ['核验价格'] },
    skills: [{ dimension: 'VOICE', name: '自然', version: { version: '1.0.0', instructions: '短句表达。' } }],
    materials: [],
  });
  assert.match(prompt.system, /POLISH_EXISTING_DRAFT/);
  assert.match(prompt.system, /factsToVerify/);
  assert.match(prompt.system, /不得.*已确认事实/);
  assert.match(prompt.message, /保留作者的个人表达/);
  assert.match(prompt.message, /核验价格/);
});

test('017 注册八个需要确认的受控文案动作', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/017_project_copy_actions.sql', import.meta.url), 'utf8');
  for (const action of COPY_ACTIONS) assert.match(migration, new RegExp(copyActionVersion(action).replace(/[.]/g, '\\.')));
  assert.match(migration, /requires_confirmation/);
  assert.match(migration, /CONTENT_WRITING/);
  assert.match(migration, /CONTENT_REWRITE/);
});

test('四平台修订提示词在设置页可见并接入服务端模板仓储', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/workspaces/settings/PromptTemplateSettings.tsx', import.meta.url), 'utf8');
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WECHAT/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.XIAOHONGSHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.ZHIHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WEIBO/);
  assert.match(api, /CREATIVE_REVISION_WECHAT/);
  assert.match(api, /CREATIVE_REVISION_WEIBO/);
  assert.match(settings, /id: 'REVISION', label: '修改文案'/);
});
