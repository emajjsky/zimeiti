import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { defaultDraftTemplate, draftTemplateScope } from '../server/services/creative-draft.cjs';
import { defaultOutlineTemplate, outlineTemplateScope } from '../server/services/creative-outline.cjs';
import { readWorkspaceLocation } from '../src/app/navigation.mjs';

test('图文平台目录包含公众号、小红书、知乎和微博', () => {
  const content = fs.readFileSync(new URL('../src/domain/content.ts', import.meta.url), 'utf8');
  assert.match(content, /'WECHAT'.*'XIAOHONGSHU'.*'ZHIHU'.*'WEIBO'.*'VIDEO_CHANNEL'/s);
  assert.match(content, /ZHIHU: '知乎'/);
  assert.match(content, /WEIBO: '微博'/);
});

test('四平台拥有独立大纲和初稿提示词 Scope', () => {
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']) {
    assert.equal(outlineTemplateScope(platform), `CREATIVE_OUTLINE_${platform}`);
    assert.equal(draftTemplateScope(platform), `CREATIVE_DRAFT_${platform}`);
  }
  assert.match(defaultOutlineTemplate('ZHIHU'), /知乎|问题语境|论证/);
  assert.match(defaultDraftTemplate('ZHIHU'), /问题语境|结论前置|论证链/);
  assert.match(defaultOutlineTemplate('WEIBO'), /微博|时效|单条|串文/);
  assert.match(defaultDraftTemplate('WEIBO'), /单条|串文|时效/);
});

test('016 增加知乎微博 Skill 并扩展旧候选平台约束', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/016_four_platform_creative_contracts.sql', import.meta.url), 'utf8');
  assert.match(migration, /creative-channel-zhihu/);
  assert.match(migration, /creative-channel-weibo/);
  assert.match(migration, /creative-layout-zhihu/);
  assert.match(migration, /creative-layout-weibo/);
  assert.match(migration, /creative_outline_candidates_platform_check/);
  assert.match(migration, /creative_draft_candidates_platform_check/);
});

test('旧平台参数不会进入公众号母稿 URL 状态', () => {
  for (const platform of ['ZHIHU', 'WEIBO']) {
    const route = readWorkspaceLocation({ search: `?view=create&project=project-1&platform=${platform}` });
    assert.equal('platform' in route, false);
    assert.equal(route.stage, null);
  }
});
