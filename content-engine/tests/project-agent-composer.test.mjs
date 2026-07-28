import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPrepareAgentRequest,
  messagesForAgentThread,
  researchQuickAction,
} from '../src/domain/project-agent-composer.mjs';

test('研究快捷动作使用唯一固定请求且仍需进入确认流程', () => {
  assert.deepEqual(researchQuickAction, {
    label: '制定研究计划',
    request: '根据已确认的规划，制定本项目的研究计划。',
  });
});

test('Agent 请求是否可准备不依赖资料数量', () => {
  assert.equal(canPrepareAgentRequest({ request: '制定研究计划', blockedReason: '', busy: 'idle', runIsActive: false }), true);
  assert.equal(canPrepareAgentRequest({ request: '   ', blockedReason: '', busy: 'idle', runIsActive: false }), false);
  assert.equal(canPrepareAgentRequest({ request: '制定研究计划', blockedReason: '写作策略未保存', busy: 'idle', runIsActive: false }), false);
  assert.equal(canPrepareAgentRequest({ request: '制定研究计划', blockedReason: '', busy: 'idle', runIsActive: true }), false);
});

test('普通对话线程隐藏由当前确认卡承载的确认消息', () => {
  const messages = [
    { id: 'user-1', messageType: 'MESSAGE', content: '制定研究计划' },
    { id: 'confirmation-1', messageType: 'CONFIRMATION', content: '研究计划已准备，确认后开始执行。' },
    { id: 'status-1', messageType: 'RUN_STATUS', content: '任务已进入执行队列。' },
  ];
  assert.deepEqual(messagesForAgentThread(messages).map((message) => message.id), ['user-1', 'status-1']);
});
