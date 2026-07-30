import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const flow = await import('../src/domain/creative-flow.mjs').catch(() => null);
const require = createRequire(import.meta.url);
const { confirmProjectPlanning } = require('../server/services/project-planning.cjs');

test('创作工作台只保留项目级规划和创作，渠道内独立完成后续步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.deepEqual(flow.creativeStages.map(({ id, label }) => [id, label]), [
    ['planning', '规划'],
    ['master', '创作'],
  ]);
});

test('项目只解锁当前阶段及已经经过的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.canOpenCreateStage('PLANNING', 'planning'), true);
  assert.equal(flow.canOpenCreateStage('PLANNING', 'research'), false);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'research'), true);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'master'), true);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'platform'), true);
  assert.equal(flow.canOpenCreateStage('COMPLETED', 'review'), true);
});

test('项目阶段映射为刷新后应恢复的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.stageRouteForProjectStage('PLANNING'), 'planning');
  assert.equal(flow.stageRouteForProjectStage('RESEARCH'), 'research');
  assert.equal(flow.stageRouteForProjectStage('MASTER_WRITING'), 'master');
  assert.equal(flow.stageRouteForProjectStage('PLATFORM_ADAPTATION'), 'master');
  assert.equal(flow.stageRouteForProjectStage('COMPLETED'), 'master');
});

test('确认规划只要求选题标题和目标平台，不把目标篇幅列为规划字段', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  const empty = flow.validatePlanningDraft({
    title: '', category: '', angle: '', objective: '', targetAudience: '', coreMessage: '',
    targetPlatforms: [], timing: 'EVERGREEN', sourceRequirements: '', constraints: '',
  });
  assert.deepEqual(empty, ['请填写选题标题', '请至少选择一个目标平台']);
  assert.equal(flow.planningFieldNames.includes('目标篇幅'), false);
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
