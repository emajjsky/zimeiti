import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWritingBriefPlatforms, shouldInitializeWritingBrief } from '../src/domain/writing-brief-platforms.mjs';

test('规划阶段不初始化写作策略，进入研究或创作后才初始化', () => {
  assert.equal(shouldInitializeWritingBrief('planning'), false);
  assert.equal(shouldInitializeWritingBrief('research'), true);
  assert.equal(shouldInitializeWritingBrief('master'), true);
});

test('旧写作策略的平台为空时，从项目已有图文版本恢复', () => {
  assert.deepEqual(resolveWritingBriefPlatforms({
    selectedPlatforms: [],
    versionPlatforms: ['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL', 'ZHIHU'],
    plannedPlatforms: ['WEIBO'],
    activePlatform: 'WEIBO',
  }), ['WECHAT', 'XIAOHONGSHU', 'ZHIHU']);
});

test('项目版本尚未加载时，从规划目标平台恢复并排除视频号', () => {
  assert.deepEqual(resolveWritingBriefPlatforms({
    selectedPlatforms: [],
    versionPlatforms: [],
    plannedPlatforms: ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'],
    activePlatform: 'VIDEO_CHANNEL',
  }), ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']);
});

test('没有任何平台上下文时，写作策略回退到公众号', () => {
  assert.deepEqual(resolveWritingBriefPlatforms({
    selectedPlatforms: [],
    versionPlatforms: [],
    plannedPlatforms: [],
    activePlatform: 'VIDEO_CHANNEL',
  }), ['WECHAT']);
});

test('已有有效写作策略时保留用户保存的平台并去重', () => {
  assert.deepEqual(resolveWritingBriefPlatforms({
    selectedPlatforms: ['WEIBO', 'WEIBO', 'VIDEO_CHANNEL'],
    versionPlatforms: ['WECHAT', 'XIAOHONGSHU'],
    plannedPlatforms: ['WECHAT'],
    activePlatform: 'WECHAT',
  }), ['WEIBO']);
});
