import assert from 'node:assert/strict';
import test from 'node:test';
import runner from '../server/runner/bailian.cjs';

const { BailianCliError, classifyBailianCliFailure } = runner;

test('百炼执行错误保留分类、退出码、耗时和标准错误', () => {
  const error = new BailianCliError('调用失败', {
    kind: 'PROCESS_EXIT', exitCode: 2, durationMs: 321, stderr: 'invalid argument', stdout: '',
  });
  assert.equal(error.code, 'BAILIAN_CLI_PROCESS_EXIT');
  assert.equal(error.kind, 'PROCESS_EXIT');
  assert.equal(error.exitCode, 2);
  assert.equal(error.durationMs, 321);
  assert.equal(error.stderr, 'invalid argument');
});

test('百炼执行失败可稳定区分超时、取消、鉴权和服务错误', () => {
  assert.equal(classifyBailianCliFailure({ timedOut: true }), 'TIMEOUT');
  assert.equal(classifyBailianCliFailure({ aborted: true }), 'ABORTED');
  assert.equal(classifyBailianCliFailure({ stderr: 'InvalidApiKey 401 unauthorized' }), 'AUTH');
  assert.equal(classifyBailianCliFailure({ stderr: 'HTTP 503 Service Unavailable' }), 'SERVICE');
  assert.equal(classifyBailianCliFailure({ stderr: 'unknown option' }), 'PROCESS_EXIT');
});
