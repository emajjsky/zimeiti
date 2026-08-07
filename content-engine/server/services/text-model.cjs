const { runBailianCli: defaultRunBailianCli } = require('../runner/bailian.cjs');

const DASHSCOPE_COMPATIBLE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

class ModelToolCallError extends Error {
  constructor(message, tokens = {}) {
    super(message);
    this.name = 'ModelToolCallError';
    this.inputTokens = tokens.inputTokens;
    this.outputTokens = tokens.outputTokens;
  }
}

function rawErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function parseErrorPayload(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

function normalizeTextModelError(error, context = {}) {
  const raw = rawErrorMessage(error);
  const payload = parseErrorPayload(raw);
  const detail = payload?.error?.message ?? payload?.message ?? raw;
  const apiCode = payload?.error?.api_code ?? payload?.api_code ?? '';
  const model = context.model ? `「${context.model}」` : '当前模型';
  const lower = `${detail}\n${apiCode}`.toLowerCase();
  if (lower.includes('product is not activated') || lower.includes('not activated')) {
    return `百炼模型${model}对应的产品未开通或未激活。请在“设置 > 模型任务策略”把当前任务切换到已开通的文本模型，或到阿里云百炼控制台开通该模型后重试。`;
  }
  if (lower.includes('百炼 cli 任务超时') || lower.includes('timeout')) {
    return `百炼模型${model}响应超时。当前任务可能需要更长生成时间，请稍后重试；如果连续超时，请在“设置 > 模型任务策略”切换到更快的文本模型。`;
  }
  return detail || '文本模型调用失败，请检查模型任务策略。';
}

function parseModelResponse(value, expectedToolName) {
  let payload;
  try { payload = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new Error('模型返回的不是有效 JSON。'); }
  const message = payload?.choices?.[0]?.message;
  const usage = payload?.usage ?? {};
  const tokens = {
    inputTokens: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : undefined,
    outputTokens: Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : undefined,
  };
  if (expectedToolName) {
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length !== 1) throw new ModelToolCallError(`模型必须且只能调用一次 ${expectedToolName}。`, tokens);
    const toolCall = toolCalls[0]?.function;
    if (toolCall?.name !== expectedToolName) throw new ModelToolCallError(`模型调用了错误的工具，应调用 ${expectedToolName}。`, tokens);
    const args = typeof toolCall.arguments === 'string' ? toolCall.arguments.trim() : JSON.stringify(toolCall.arguments ?? null);
    if (!args || args === 'null') throw new ModelToolCallError(`${expectedToolName} 没有提交参数。`, tokens);
    return { content: args, toolCall: { name: toolCall.name, arguments: args }, ...tokens };
  }
  const content = message?.content ?? payload?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回可用文本。');
  return { content: content.trim(), ...tokens };
}

function openAiChatBody(input, maxTokens, temperature) {
  return {
    model: input.model,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.message }],
    temperature,
    max_tokens: maxTokens,
    ...(input.tools?.length ? {
      tools: input.tools,
      ...(input.requiredToolName ? { tool_choice: { type: 'function', function: { name: input.requiredToolName } } } : {}),
    } : { response_format: { type: 'json_object' } }),
  };
}

async function requestOpenAiCompatibleChat({ fetchImpl, baseUrl, apiKey, input, maxTokens, temperature, timeoutMs, errorPrefix }) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(openAiChatBody(input, maxTokens, temperature)),
    });
  } catch (error) {
    throw new Error(`${errorPrefix}${error instanceof Error ? error.message : '网络错误'}。`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = [payload?.error?.message, payload?.message].find((item) => typeof item === 'string') ?? '';
    } catch { /* HTTP 状态足以说明失败。 */ }
    throw new Error(`${errorPrefix}HTTP ${response.status}${detail ? `：${detail}` : ''}。`);
  }
  return parseModelResponse(await response.json(), input.requiredToolName);
}

function createTextModelRunner({ runBailianCli = defaultRunBailianCli, fetchImpl = fetch } = {}) {
  return {
    async runText(input) {
      const maxTokens = Number.isInteger(input.maxTokens) ? Math.max(256, Math.min(input.maxTokens, 16_000)) : 1_800;
      const temperature = Number.isFinite(input.temperature) ? Math.max(0, Math.min(input.temperature, 1)) : 0.2;
      const timeoutMs = Number.isInteger(input.timeoutMs) ? Math.max(15_000, Math.min(input.timeoutMs, 300_000)) : 180_000;
      if (input.provider === 'BAILIAN_CLI') {
        if (!input.apiKey) throw new Error('工作空间未配置百炼 Key。');
        if (input.requiredToolName && !input.tools?.length) throw new ModelToolCallError(`必须提供 ${input.requiredToolName} 的工具定义。`);
        if (input.tools?.length) {
          try {
            return await requestOpenAiCompatibleChat({
              fetchImpl,
              baseUrl: input.connection?.baseUrl || input.baseUrl || process.env.DASHSCOPE_BASE_URL || DASHSCOPE_COMPATIBLE_BASE_URL,
              apiKey: input.apiKey,
              input,
              maxTokens,
              temperature,
              timeoutMs,
              errorPrefix: '百炼文本模型调用失败：',
            });
          } catch (error) {
            if (error instanceof ModelToolCallError) throw error;
            throw new Error(normalizeTextModelError(error, { provider: input.provider, model: input.model }));
          }
        }
        const args = ['text', 'chat', '--model', input.model, '--system', input.system, '--message', input.message, '--max-tokens', String(maxTokens), '--temperature', String(temperature)];
        args.push('--output', 'json');
        let output;
        try {
          output = await runBailianCli(args, input.apiKey, timeoutMs);
        } catch (error) {
          throw new Error(normalizeTextModelError(error, { provider: input.provider, model: input.model }));
        }
        return parseModelResponse(output, input.requiredToolName);
      }
      if (input.provider !== 'EXTERNAL_API') throw new Error('不支持的文本模型来源。');
      if (!input.connection?.apiKey || !input.connection?.baseUrl) throw new Error('外部 API 连接不可用。');
      const baseUrl = input.connection.baseUrl.replace(/\/$/, '');
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${input.connection.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: input.model,
            messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.message }],
            temperature,
            max_tokens: maxTokens,
            ...(input.tools?.length ? {
              tools: input.tools,
              ...(input.requiredToolName ? { tool_choice: { type: 'function', function: { name: input.requiredToolName } } } : {}),
            } : { response_format: { type: 'json_object' } }),
          }),
        });
      } catch (error) { throw new Error(`外部文本模型请求失败：${error instanceof Error ? error.message : '网络错误'}。`); }
      if (!response.ok) {
        let detail = '';
        try { const payload = await response.json(); detail = [payload?.error?.message, payload?.message].find((item) => typeof item === 'string') ?? ''; } catch { /* HTTP 状态足以说明失败。 */ }
        throw new Error(`外部文本模型调用失败（HTTP ${response.status}${detail ? `：${detail}` : ''}）。`);
      }
      return parseModelResponse(await response.json(), input.requiredToolName);
    },
  };
}

module.exports = { createTextModelRunner, parseModelResponse, normalizeTextModelError, ModelToolCallError };
