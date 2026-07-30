const { ZodError } = require('zod');

function publicErrorMessage(error) {
  if (error instanceof ZodError) return '提交内容不完整，请刷新后重试。';
  return error?.message || '请求失败。';
}

module.exports = { publicErrorMessage };
