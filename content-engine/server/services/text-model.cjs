const { runBailianCli: defaultRunBailianCli } = require('../runner/bailian.cjs');

function parseModelResponse(value) {
  let payload;
  try { payload = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new Error('模型返回的不是有效 JSON。'); }
  const content = payload?.choices?.[0]?.message?.content ?? payload?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回可用文本。');
  const usage = payload?.usage ?? {};
  return {
    content: content.trim(),
    inputTokens: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : undefined,
    outputTokens: Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : undefined,
  };
}

function createTextModelRunner({ runBailianCli = defaultRunBailianCli, fetchImpl = fetch } = {}) {
  return {
    async runText(input) {
      if (input.provider === 'BAILIAN_CLI') {
        if (!input.apiKey) throw new Error('工作空间未配置百炼 Key。');
        const output = await runBailianCli(['text', 'chat', '--model', input.model, '--system', input.system, '--message', input.message, '--max-tokens', '1800', '--temperature', '0.2', '--output', 'json'], input.apiKey);
        return parseModelResponse(output);
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
          body: JSON.stringify({ model: input.model, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.message }], temperature: 0.2, max_tokens: 1800, response_format: { type: 'json_object' } }),
        });
      } catch (error) { throw new Error(`外部文本模型请求失败：${error instanceof Error ? error.message : '网络错误'}。`); }
      if (!response.ok) {
        let detail = '';
        try { const payload = await response.json(); detail = [payload?.error?.message, payload?.message].find((item) => typeof item === 'string') ?? ''; } catch { /* HTTP 状态足以说明失败。 */ }
        throw new Error(`外部文本模型调用失败（HTTP ${response.status}${detail ? `：${detail}` : ''}）。`);
      }
      return parseModelResponse(await response.json());
    },
  };
}

module.exports = { createTextModelRunner, parseModelResponse };
