const { z } = require('zod');
const { compileVisualPlan } = require('./visual-planning.cjs');

const assetIds = z.array(z.string().uuid()).max(3).default([]);
const wechatGenerationInput = z.object({
  platform: z.literal('WECHAT'),
  visualItemId: z.string().trim().min(1).max(100),
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
  if (platform === 'WECHAT' && value && typeof value === 'object' && ('prompt' in value || 'size' in value)) {
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
    items: [item],
    styleProfile: draft.visualPlan?.styleProfile,
  });
  return { prompt: compiled.prompt, size: compiled.size, assetIds: input.assetIds, item: compiled };
}

module.exports = { parseVisualGenerationRequest, resolveWechatVisualGenerationSpec, visualGenerationInput };
