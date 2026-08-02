import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const flow = await import('../src/domain/creative-flow.mjs').catch(() => null);
const require = createRequire(import.meta.url);
const { confirmProjectPlanning } = require('../server/services/project-planning.cjs');

test('创作工作台固定为五步公众号母稿流程', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.deepEqual(flow.creativeStages.map(({ id, label }) => [id, label]), [
    ['preparation', '内容准备'],
    ['copy', '公众号正文'],
    ['visual', '公众号配图'],
    ['layout', '公众号排版'],
    ['drafts', '完成草稿'],
  ]);
});

test('项目只解锁当前阶段及已经经过的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.canOpenCreateStage('PLANNING', 'preparation'), true);
  assert.equal(flow.canOpenCreateStage('PLANNING', 'copy'), false);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'copy'), true);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'visual'), false);
  assert.equal(flow.canOpenCreateStage('VISUAL', 'visual'), true);
  assert.equal(flow.canOpenCreateStage('LAYOUT', 'layout'), true);
  assert.equal(flow.canOpenCreateStage('COMPLETED', 'drafts'), true);
  assert.equal(flow.canOpenCreateStage('COMPLETED', 'review'), false);
});

test('项目阶段映射为刷新后应恢复的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.stageRouteForProjectStage('PLANNING'), 'preparation');
  assert.equal(flow.stageRouteForProjectStage('RESEARCH'), 'preparation');
  assert.equal(flow.stageRouteForProjectStage('MASTER_WRITING'), 'copy');
  assert.equal(flow.stageRouteForProjectStage('VISUAL'), 'visual');
  assert.equal(flow.stageRouteForProjectStage('LAYOUT'), 'layout');
  assert.equal(flow.stageRouteForProjectStage('COMPLETED'), 'drafts');
});

test('内容准备只要求选题标题且不再显示目标平台字段', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  const empty = flow.validatePlanningDraft({
    title: '', category: '', angle: '', objective: '', targetAudience: '', coreMessage: '',
    targetPlatforms: [], timing: 'EVERGREEN', sourceRequirements: '', constraints: '',
  });
  assert.deepEqual(empty, ['请填写选题标题']);
  assert.equal(flow.planningFieldNames.includes('目标平台'), false);
  assert.equal(flow.planningFieldNames.includes('目标篇幅'), false);
});

test('创作编排器不再包含平台切换、审核或旧步骤别名', async () => {
  const source = await readFile(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /activePlatform|onPlatform|channel-platform-tabs|ReviewWorkspace/);
  assert.doesNotMatch(source, /stage === '(?:planning|research|master|platform|review)'/);
  assert.match(source, /PreparationWorkspace/);
  assert.match(source, /DraftResultWorkspace/);
});

test('确认规划会为缺失的可推导字段补齐确定性默认值', () => {
  const project = {
    id: 'minimal-planning-project', title: '传统家具的AI进化论', originType: 'MANUAL', stage: 'PLANNING', status: 'BRIEF',
    planning: {}, planningVersion: 0, coreViewpoint: '', factChecks: [], versions: [],
    createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
  };
  const completed = confirmProjectPlanning(project, { title: '传统家具的AI进化论', category: 'AI', targetPlatforms: ['WECHAT'] }, '2026-07-29T01:00:00.000Z');
  assert.match(completed.planning.angle, /传统家具的AI进化论/);
  assert.ok(completed.planning.objective);
  assert.ok(completed.planning.targetAudience);
  assert.ok(completed.planning.coreMessage);
});
