import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectCenterAction,
  projectsForCenterFilter,
  selectedProjectIdForList,
} from '../src/domain/creative-project-center.mjs';

const projects = [
  { id: 'planning-1', stage: 'PLANNING' },
  { id: 'research-1', stage: 'RESEARCH' },
  { id: 'visual-1', stage: 'VISUAL' },
  { id: 'completed-1', stage: 'COMPLETED' },
];

test('项目中心阶段筛选只返回对应的统一项目', () => {
  assert.deepEqual(projectsForCenterFilter(projects, 'PLANNING').map((item) => item.id), ['planning-1']);
  assert.deepEqual(projectsForCenterFilter(projects, 'PLATFORM').map((item) => item.id), ['visual-1']);
  assert.deepEqual(projectsForCenterFilter(projects, 'ALL').map((item) => item.id), projects.map((item) => item.id));
});

test('当前项目不在筛选结果时选择第一项，空结果不保留旧项目', () => {
  assert.equal(selectedProjectIdForList(projects, 'research-1'), 'research-1');
  assert.equal(selectedProjectIdForList(projectsForCenterFilter(projects, 'PLANNING'), 'research-1'), 'planning-1');
  assert.equal(selectedProjectIdForList([], 'research-1'), '');
});

test('项目阶段映射为唯一下一步动作', () => {
  assert.equal(projectCenterAction('PLANNING'), '完成规划');
  assert.equal(projectCenterAction('RESEARCH'), '继续研究');
  assert.equal(projectCenterAction('MASTER_WRITING'), '继续正文');
  assert.equal(projectCenterAction('COMPLETED'), '查看项目');
});
