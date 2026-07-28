import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTodayTitle, projectTaskEntries, projectTaskMeta } from '../src/domain/today.mjs';

test('行动中心日期根据当前日期生成', () => {
  assert.equal(formatTodayTitle(new Date('2026-07-26T08:00:00+08:00')), '今天，7 月 26 日');
});

test('内容项目状态映射为真实下一步', () => {
  assert.deepEqual(projectTaskMeta('BRIEF'), { prefix: '完善创作设定', action: '去设定', view: 'create' });
  assert.deepEqual(projectTaskMeta('SCHEDULED'), { prefix: '确认发布安排', action: '去发布', view: 'publish' });
  assert.equal(projectTaskMeta('ARCHIVED'), null);
});

test('行动中心只从真实项目生成待办，不注入示例任务', () => {
  const tasks = projectTaskEntries([
    { id: 'project-1', title: '普通人如何核验 AI 信息', status: 'BRIEF', updatedAt: '2026-07-28T08:00:00.000Z' },
    { id: 'project-2', title: '已归档内容', status: 'ARCHIVED', updatedAt: '2026-07-27T08:00:00.000Z' },
  ]);

  assert.deepEqual(tasks, [{
    id: 'project:project-1',
    projectId: 'project-1',
    title: '完善创作设定：普通人如何核验 AI 信息',
    sub: '创作设定 · 更新于 2026-07-28T08:00:00.000Z',
    action: '去设定',
    view: 'create',
  }]);
});
