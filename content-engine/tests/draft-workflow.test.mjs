import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canOpenDraftStep,
  draftImageLimit,
  draftWorkflowSteps,
  routeForProjectStage,
} from '../src/domain/draft-workflow.mjs';

test('公众号母稿流程固定为五个线性步骤', () => {
  assert.deepEqual(
    draftWorkflowSteps.map(({ id, label, stage }) => [id, label, stage]),
    [
      ['preparation', '内容准备', 'PREPARING'],
      ['copy', '公众号正文', 'WECHAT_WRITING'],
      ['visual', '公众号配图', 'WECHAT_IMAGING'],
      ['layout', '公众号排版', 'WECHAT_LAYOUT'],
      ['drafts', '完成草稿', 'DRAFT_READY'],
    ],
  );
});

test('项目阶段稳定映射到刷新后应该恢复的步骤', () => {
  assert.equal(routeForProjectStage('PREPARING'), 'preparation');
  assert.equal(routeForProjectStage('WECHAT_WRITING'), 'copy');
  assert.equal(routeForProjectStage('WECHAT_IMAGING'), 'visual');
  assert.equal(routeForProjectStage('WECHAT_LAYOUT'), 'layout');
  assert.equal(routeForProjectStage('DRAFT_READY'), 'drafts');
});

test('只能打开当前阶段及已经完成的步骤', () => {
  assert.equal(canOpenDraftStep('PREPARING', 'preparation'), true);
  assert.equal(canOpenDraftStep('PREPARING', 'copy'), false);
  assert.equal(canOpenDraftStep('WECHAT_WRITING', 'preparation'), true);
  assert.equal(canOpenDraftStep('WECHAT_WRITING', 'copy'), true);
  assert.equal(canOpenDraftStep('WECHAT_WRITING', 'layout'), false);
  assert.equal(canOpenDraftStep('DRAFT_READY', 'drafts'), true);
  assert.equal(canOpenDraftStep('DRAFT_READY', 'unknown'), false);
});

test('各平台图片上限固定且不接受已删除的平台', () => {
  assert.equal(draftImageLimit('WECHAT'), 12);
  assert.equal(draftImageLimit('XIAOHONGSHU'), 9);
  assert.equal(draftImageLimit('WEIBO'), 9);
  assert.throws(() => draftImageLimit('ZHIHU'), /不支持的平台/);
});
