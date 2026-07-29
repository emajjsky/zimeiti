import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allCapturedSourceIds,
  initialSourceSelection,
  toggleSourceSelection,
} from '../src/domain/research-source-selection.mjs';

const sources = [
  { id: 'a', status: 'CAPTURED', selected: true },
  { id: 'b', status: 'CAPTURED', selected: false },
  { id: 'c', status: 'NEEDS_USER', selected: true },
  { id: 'd', status: 'FAILED', selected: false },
];

test('来源选择只恢复已保存且可核验的来源', () => {
  assert.deepEqual(initialSourceSelection(sources), ['a']);
});

test('全选只包含已经保存的来源', () => {
  assert.deepEqual(allCapturedSourceIds(sources), ['a', 'b']);
});

test('切换来源不允许选择需补充或失败项', () => {
  assert.deepEqual(toggleSourceSelection(['a'], sources, 'b'), ['a', 'b']);
  assert.deepEqual(toggleSourceSelection(['a'], sources, 'c'), ['a']);
  assert.deepEqual(toggleSourceSelection(['a'], sources, 'a'), []);
});
