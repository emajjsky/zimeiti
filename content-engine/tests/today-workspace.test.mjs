import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatTodayTitle, projectTaskMeta } from '../src/domain/today.mjs';

test('行动中心日期根据当前日期生成', () => {
  assert.equal(formatTodayTitle(new Date('2026-07-26T08:00:00+08:00')), '今天，7 月 26 日');
});

test('内容项目状态映射为真实下一步', () => {
  assert.deepEqual(projectTaskMeta('BRIEF'), { prefix: '完善创作设定', action: '去设定', view: 'create' });
  assert.deepEqual(projectTaskMeta('SCHEDULED'), { prefix: '确认发布安排', action: '去发布', view: 'publish' });
  assert.equal(projectTaskMeta('ARCHIVED'), null);
});

test('行动中心不再包含固定日期和示例任务', async () => {
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /今天，7 月 22 日|今日 11:00 前|审核小红书 8 页图文|Notion 教程下集|周报大纲审核/);
  assert.match(source, /title=\{formatTodayTitle\(\)\}/);
  assert.match(source, /topics\.filter/);
  assert.match(source, /projects\.map/);
});
