const { runBailianCli: defaultRunBailianCli } = require('../runner/bailian.cjs');

class ModelToolCallError extends Error {
  constructor(message, tokens = {}) {
    super(message);
    this.name = 'ModelToolCallError';
    this.inputTokens = tokens.inputTokens;
    this.outputTokens = tokens.outputTokens;
  }
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

function createTextModelRunner({ runBailianCli = defaultRunBailianCli, fetchImpl = fetch } = {}) {
  return {
    async runText(input) {
      const maxTokens = Number.isInteger(input.maxTokens) ? Math.max(256, Math.min(input.maxTokens, 16_000)) : 1_800;
      const temperature = Number.isFinite(input.temperature) ? Math.max(0, Math.min(input.temperature, 1)) : 0.2;
      if (input.provider === 'BAILIAN_CLI') {
        if (!input.apiKey) throw new Error('工作空间未配置百炼 Key。');
        const args = ['text', 'chat', '--model', input.model, '--system', input.system, '--message', input.message, '--max-tokens', String(maxTokens), '--temperature', String(temperature)];
        for (const tool of input.tools ?? []) args.push('--tool', JSON.stringify(tool));
        args.push('--output', 'json');
        const output = await runBailianCli(args, input.apiKey);
        return parseModelResponse(output, input.requiredToolName);
      }
      if (input.provider !== 'EXTERNAL_API') throw new Error('不支持的文本模型来源。');
      if (!input.connection?.apiKey || !input.connection?.baseUrl) throw new Error('外部 API 连接不可用。');
      const baseUrl = input.connection.baseUrl.replace(/\/$/, '');
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
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

module.exports = { createTextModelRunner, parseModelResponse, ModelToolCallError };
