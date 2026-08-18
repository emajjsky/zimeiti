const { ZodError } = require('zod');

function publicErrorMessage(error) {
  if (error instanceof ZodError) return '提交内容不完整，请刷新后重试。';
  return error?.message || '请求失败。';
}

function responseStatusCode(error) {
  const status = Number(error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

module.exports = { publicErrorMessage, responseStatusCode };
