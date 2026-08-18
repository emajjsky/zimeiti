const { z } = require('zod');
const { businessError } = require('./business-errors.cjs');
const { compileVisualPlan } = require('./visual-planning.cjs');

const assetIds = z.array(z.string().uuid()).max(3).default([]);
const wechatGenerationInput = z.object({
  platform: z.literal('WECHAT'),
  visualItemId: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(4).max(8_000).optional(),
  assetIds,
}).strict();
const socialGenerationInput = z.object({
  platform: z.enum(['XIAOHONGSHU', 'WEIBO']),
  prompt: z.string().trim().min(4).max(8_000),
  size: z.enum(['3:4', '1:1']),
  assetIds,
}).strict();
const visualGenerationInput = z.discriminatedUnion('platform', [wechatGenerationInput, socialGenerationInput]);

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VISUAL_GENERATION_INPUT_INVALID';
  return error;
}

function parseVisualGenerationRequest(value) {
  const parsed = visualGenerationInput.safeParse(value);
  if (parsed.success) return parsed.data;
  const platform = value && typeof value === 'object' ? value.platform : null;
  if (platform === 'WECHAT' && value && typeof value === 'object' && 'size' in value) {
    throw inputError('公众号生图请求不能提交提示词或画幅，最终参数由服务端根据当前配图项编译。');
  }
  throw inputError('生图请求缺少必要参数或包含未允许的字段。');
}

async function resolveWechatVisualGenerationSpec({ input, draft, parseItem = (item) => item }) {
  const plan = Array.isArray(draft?.visualPlan?.plan) ? draft.visualPlan.plan : [];
  const rawItem = plan.find((item) => item?.id === input.visualItemId);
  if (!rawItem) {
    const error = new Error('当前公众号草稿中没有找到要生成的配图项，请刷新方案后重试。');
    error.statusCode = 404;
    error.code = 'VISUAL_PLAN_ITEM_NOT_FOUND';
    throw error;
  }
  const item = parseItem(rawItem);
  const [compiled] = await compileVisualPlan({
    platform: 'WECHAT',
    title: draft.title,
    body: draft.body,
    items: [item],
    styleProfile: draft.visualPlan?.styleProfile,
  });
  return { prompt: input.prompt ?? compiled.prompt, size: compiled.size, assetIds: input.assetIds, item: compiled };
}

function parseBailianCliErrorPayload(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const jsonStart = rawMessage.indexOf('{');
  const jsonEnd = rawMessage.lastIndexOf('}');
  let payload = null;
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      payload = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1));
    } catch {
      payload = null;
    }
  }
  const apiError = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
    ? payload.error
    : null;
  return {
    rawMessage,
    message: typeof apiError?.message === 'string' && apiError.message.trim() ? apiError.message.trim() : rawMessage,
    apiCode: typeof apiError?.api_code === 'string' ? apiError.api_code : undefined,
    httpStatus: typeof apiError?.http_status === 'number' ? apiError.http_status : undefined,
    requestId: typeof apiError?.request_id === 'string' ? apiError.request_id : undefined,
  };
}

function isBailianDataInspectionFailure(error) {
  const parsed = error && typeof error === 'object' && 'rawMessage' in error && 'message' in error
    ? error
    : parseBailianCliErrorPayload(error);
  return parsed.apiCode === 'DataInspectionFailed'
    || /DataInspectionFailed/i.test(parsed.rawMessage)
    || /inappropriate content/i.test(parsed.message);
}

function sanitizeBailianVisualPrompt(prompt) {
  const text = String(prompt ?? '').trim();
  if (!text) return text;
  const replacements = [
    [/(?:中国|世界)?地图/gi, '数据示意图'],
    [/国旗|国徽|边界线|领土|疆界/gi, ''],
    [/政治|政党|选举|总统|主席|领导人/gi, ''],
    [/战争|武器|暴力|血腥|冲突/gi, ''],
    [/裸露|色情|成人内容|未成年(?:人|儿童)?/gi, ''],
    [/二维码|logo|水印|签名|文字海报/gi, ''],
  ];
  let sanitized = text;
  for (const [pattern, replacement] of replacements) sanitized = sanitized.replace(pattern, replacement);
  sanitized = sanitized.replace(/\s+/g, ' ').replace(/([，,。；;：:])\1+/g, '$1').replace(/([，,。；;：:])\s*/g, '$1').replace(/^\s*[，,。；;：:\-—]+|[，,。；;：:\-—]+\s*$/g, '').trim();
  return sanitized || text;
}

function buildBailianVisualGenerationError(error, { retried = false } = {}) {
  const parsed = parseBailianCliErrorPayload(error);
  if (isBailianDataInspectionFailure(parsed)) {
    return businessError(
      400,
      'IMAGE_CONTENT_REJECTED',
      retried
        ? '百炼内容审核仍未通过，请换一个更中性、更具体的画面描述后重试。'
        : '百炼内容审核未通过，已自动尝试一次弱化敏感词的重试，但仍被拦下。请换一个更中性、更具体的画面描述后重试。',
      { apiCode: parsed.apiCode, requestId: parsed.requestId },
    );
  }
  if (parsed.httpStatus === 400) {
    return businessError(
      400,
      'IMAGE_GENERATION_INVALID',
      `百炼生图参数无效：${parsed.message}`,
      { apiCode: parsed.apiCode, requestId: parsed.requestId },
    );
  }
  if ([502, 503, 504].includes(parsed.httpStatus)) {
    return businessError(
      502,
      'IMAGE_GENERATION_SERVICE_UNAVAILABLE',
      '百炼生图服务暂时不可用，请稍后重试。',
      { apiCode: parsed.apiCode, requestId: parsed.requestId },
    );
  }
  return businessError(
    502,
    'IMAGE_GENERATION_FAILED',
    parsed.message || '百炼生图失败，请稍后重试。',
    { apiCode: parsed.apiCode, requestId: parsed.requestId },
  );
}

module.exports = {
  buildBailianVisualGenerationError,
  isBailianDataInspectionFailure,
  parseBailianCliErrorPayload,
  parseVisualGenerationRequest,
  resolveWechatVisualGenerationSpec,
  sanitizeBailianVisualPrompt,
  visualGenerationInput,
};
