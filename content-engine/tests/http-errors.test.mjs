import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { publicErrorMessage } = require('../server/services/http-errors.cjs');
const { businessError, errorPayload } = require('../server/services/business-errors.cjs');

test('结构化参数校验失败时不向页面暴露 Zod JSON', () => {
  let error;
  try {
    z.object({ selectedPlatforms: z.array(z.string()).min(1) }).parse({ selectedPlatforms: [] });
  } catch (reason) {
    error = reason;
  }

  assert.equal(publicErrorMessage(error), '提交内容不完整，请刷新后重试。');
  assert.doesNotMatch(publicErrorMessage(error), /selectedPlatforms|too_small|expected array/i);
});

test('普通业务错误保留原有中文提示', () => {
  assert.equal(publicErrorMessage(new Error('当前模型不可用，请重新选择。')), '当前模型不可用，请重新选择。');
});

test('稳定业务错误只公开明确允许的错误码和详情', () => {
  const error = businessError(409, 'ASSET_IN_USE', '素材仍被项目引用。', { projectCount: 2 });
  assert.equal(error.statusCode, 409);
  assert.deepEqual(errorPayload(error), {
    message: '素材仍被项目引用。',
    code: 'ASSET_IN_USE',
    details: { projectCount: 2 },
  });
});

test('普通异常响应不伪造业务错误码和详情', () => {
  assert.deepEqual(errorPayload(new Error('请求失败。')), { message: '请求失败。' });
});
