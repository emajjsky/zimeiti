import assert from 'node:assert/strict';
import test from 'node:test';

const flow = await import('../src/domain/creative-flow.mjs').catch(() => null);

test('创作工作台固定为规划到审核的七步链路', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.deepEqual(flow.creativeStages.map(({ id, label }) => [id, label]), [
    ['planning', '规划'],
    ['research', '研究'],
    ['master', '正文'],
    ['platform', '平台版本'],
    ['visual', '配图'],
    ['layout', '排版'],
    ['review', '审核'],
  ]);
});

test('项目只解锁当前阶段及已经经过的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.canOpenCreateStage('PLANNING', 'planning'), true);
  assert.equal(flow.canOpenCreateStage('PLANNING', 'research'), false);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'research'), true);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'master'), true);
  assert.equal(flow.canOpenCreateStage('MASTER_WRITING', 'platform'), false);
  assert.equal(flow.canOpenCreateStage('COMPLETED', 'review'), true);
});

test('项目阶段映射为刷新后应恢复的创作步骤', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  assert.equal(flow.stageRouteForProjectStage('PLANNING'), 'planning');
  assert.equal(flow.stageRouteForProjectStage('RESEARCH'), 'research');
  assert.equal(flow.stageRouteForProjectStage('MASTER_WRITING'), 'master');
  assert.equal(flow.stageRouteForProjectStage('COMPLETED'), 'review');
});

test('确认规划前检查核心决策字段，不把目标篇幅列为规划字段', () => {
  assert.ok(flow, '创作流程模型尚未实现');
  const empty = flow.validatePlanningDraft({
    title: '', category: '', angle: '', objective: '', targetAudience: '', coreMessage: '',
    targetPlatforms: [], timing: 'EVERGREEN', sourceRequirements: '', constraints: '',
  });
  assert.deepEqual(empty, ['请填写选题标题', '请填写创作角度', '请填写创作目标', '请填写目标受众', '请填写核心表达', '请至少选择一个目标平台']);
  assert.equal(flow.planningFieldNames.includes('目标篇幅'), false);
});
