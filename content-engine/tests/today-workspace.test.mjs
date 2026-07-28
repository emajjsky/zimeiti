import assert from 'node:assert/strict';
import test from 'node:test';
import { completedProjects, formatTodayTitle, projectTaskEntries, projectTaskMeta } from '../src/domain/today.mjs';

test('行动中心日期根据当前日期生成', () => {
  assert.equal(formatTodayTitle(new Date('2026-07-26T08:00:00+08:00')), '今天，7 月 26 日');
});

test('内容项目阶段映射为真实下一步', () => {
  assert.deepEqual(projectTaskMeta('PLANNING'), { prefix: '完成规划', action: '去规划', view: 'create' });
  assert.deepEqual(projectTaskMeta('PLATFORM_ADAPTATION'), { prefix: '制作平台版本', action: '去制作', view: 'create' });
  assert.deepEqual(projectTaskMeta('REVIEW'), { prefix: '完成审核', action: '去审核', view: 'create' });
  assert.equal(projectTaskMeta('COMPLETED'), null);
});

test('行动中心只从真实项目生成待办，不注入示例任务', () => {
  const tasks = projectTaskEntries([
    { id: 'project-1', title: '普通人如何核验 AI 信息', stage: 'PLANNING', updatedAt: '2026-07-28T08:00:00.000Z' },
    { id: 'project-2', title: '已完成内容', stage: 'COMPLETED', updatedAt: '2026-07-27T08:00:00.000Z' },
  ]);

  assert.deepEqual(tasks, [{
    id: 'project:project-1',
    projectId: 'project-1',
    title: '完成规划：普通人如何核验 AI 信息',
    sub: '待规划 · 更新于 2026-07-28T08:00:00.000Z',
    action: '去规划',
    view: 'create',
  }]);
});

test('复盘入口只展示已经完成的真实项目', () => {
  const projects = [
    { id: 'project-1', stage: 'REVIEW' },
    { id: 'project-2', stage: 'COMPLETED' },
    { id: 'project-3', stage: 'RESEARCH' },
  ];
  assert.deepEqual(completedProjects(projects).map((project) => project.id), ['project-2']);
});
