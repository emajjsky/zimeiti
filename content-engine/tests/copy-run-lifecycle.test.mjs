import assert from 'node:assert/strict';
import test from 'node:test';
import { copyRunCompletion } from '../src/domain/copy-run-lifecycle.mjs';

const watchedRun = { id: 'run-1', action: 'GENERATE_DRAFT' };

test('首次正文运行成功后要求同步正式草稿', () => {
  assert.deepEqual(copyRunCompletion(watchedRun, { ...watchedRun, status: 'SUCCEEDED' }), { type: 'SYNC_GENERATED_DRAFT' });
});

test('失败、取消和未结束运行不会同步正式草稿', () => {
  assert.deepEqual(copyRunCompletion(watchedRun, { ...watchedRun, status: 'FAILED', error: '模型调用失败。' }), { type: 'ERROR', message: '模型调用失败。' });
  assert.deepEqual(copyRunCompletion(watchedRun, { ...watchedRun, status: 'CANCELLED' }), { type: 'COMPLETE' });
  assert.deepEqual(copyRunCompletion(watchedRun, { ...watchedRun, status: 'RUNNING' }), { type: 'WAIT' });
});

test('其他任务或非首次正文成功不触发正式草稿同步', () => {
  assert.deepEqual(copyRunCompletion(watchedRun, { id: 'run-2', action: 'GENERATE_DRAFT', status: 'SUCCEEDED' }), { type: 'IGNORE' });
  const revisionRun = { id: 'run-3', action: 'POLISH_EXISTING_DRAFT' };
  assert.deepEqual(copyRunCompletion(revisionRun, { ...revisionRun, status: 'SUCCEEDED' }), { type: 'COMPLETE' });
});
