import assert from 'node:assert/strict';
import test from 'node:test';

const { createTextModelRunner, ModelToolCallError } = await import('../server/services/text-model.cjs');

const payload = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });

test('百炼策略通过 CLI 返回标准文本结果', async () => {
  let args;
  let timeoutMs;
  const runner = createTextModelRunner({ runBailianCli: async (nextArgs, _apiKey, nextTimeoutMs) => { args = nextArgs; timeoutMs = nextTimeoutMs; return payload; } });
  const result = await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', maxTokens: 6_000, temperature: 0.15 });
  assert.deepEqual(result, { content: '{"ok":true}', inputTokens: 12, outputTokens: 8 });
  assert.equal(args[args.indexOf('--max-tokens') + 1], '6000');
  assert.equal(args[args.indexOf('--temperature') + 1], '0.15');
  assert.equal(timeoutMs, 180_000);
});

test('百炼未激活产品错误会转成可操作中文提示', async () => {
  const runner = createTextModelRunner({
    runBailianCli: async () => {
      throw new Error('{ "error": { "message": "The product is not activated, please confirm that you have activated products and try again after activation.", "api_code": "invalid_request_error" } }');
    },
  });
  await assert.rejects(
    runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'ZHIPU/GLM-5.2', system: 'system', message: 'message' }),
    (error) => error.message.includes('ZHIPU/GLM-5.2')
      && error.message.includes('未开通或未激活')
      && error.message.includes('模型任务策略')
      && !error.message.includes('The product is not activated'),
  );
});

test('百炼 CLI 超时错误会提示重试或切换更快模型', async () => {
  const runner = createTextModelRunner({
    runBailianCli: async () => { throw new Error('百炼 CLI 任务超时。'); },
  });
  await assert.rejects(
    runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen3.7-plus-2026-05-26', system: 'system', message: 'message' }),
    (error) => error.message.includes('qwen3.7-plus-2026-05-26')
      && error.message.includes('响应超时')
      && error.message.includes('更快的文本模型')
      && !error.message.includes('百炼 CLI 任务超时'),
  );
});

test('百炼文本调用允许为慢任务覆盖等待时间', async () => {
  let timeoutMs;
  const runner = createTextModelRunner({ runBailianCli: async (_args, _apiKey, nextTimeoutMs) => { timeoutMs = nextTimeoutMs; return payload; } });
  await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', timeoutMs: 240_000 });
  assert.equal(timeoutMs, 240_000);
});

test('外部策略通过连接的 chat completions 返回标准文本结果', async () => {
  let request;
  const runner = createTextModelRunner({
    runBailianCli: async () => { throw new Error('CLI should not run'); },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await runner.runText({ provider: 'EXTERNAL_API', connection: { baseUrl: 'https://models.example/v1/', apiKey: 'secret' }, model: 'external-text', system: 'system', message: 'message' });
  assert.equal(request.url, 'https://models.example/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(result, { content: '{"ok":true}', inputTokens: 12, outputTokens: 8 });
});

test('多图配图策划允许最多一万六千输出 Token', async () => {
  let args;
  const runner = createTextModelRunner({ runBailianCli: async (nextArgs) => { args = nextArgs; return payload; } });
  await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', maxTokens: 20_000 });
  assert.equal(args[args.indexOf('--max-tokens') + 1], '16000');
});

test('百炼严格工具调用走兼容接口并强制指定工具', async () => {
  let request;
  const toolPayload = JSON.stringify({
    choices: [{ message: { content: '', tool_calls: [{ type: 'function', function: { name: 'submit_visual_plan', arguments: '{"strategy":"完整方案","items":[]}' } }] } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
  const tool = { type: 'function', function: { name: 'submit_visual_plan', parameters: { type: 'object' } } };
  const runner = createTextModelRunner({
    runBailianCli: async () => { throw new Error('CLI should not run for strict tools'); },
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body), headers: options.headers };
      return new Response(toolPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', tools: [tool], requiredToolName: 'submit_visual_plan' });
  assert.deepEqual(result.toolCall, { name: 'submit_visual_plan', arguments: '{"strategy":"完整方案","items":[]}' });
  assert.equal(result.content, result.toolCall.arguments);
  assert.equal(request.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer secret');
  assert.equal(request.body.enable_thinking, false);
  assert.deepEqual(request.body.tools, [tool]);
  assert.deepEqual(request.body.tool_choice, { type: 'function', function: { name: 'submit_visual_plan' } });
});

test('严格工具调用拒绝缺失工具定义和错误工具，不把文本当结构化结果', async () => {
  const plainRunner = createTextModelRunner({ runBailianCli: async () => payload });
  await assert.rejects(
    plainRunner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', tools: [], requiredToolName: 'submit_visual_plan' }),
    (error) => error instanceof ModelToolCallError && error.message.includes('必须提供 submit_visual_plan 的工具定义'),
  );
  const wrongTool = JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'other_tool', arguments: '{}' } }] } }] });
  const wrongRunner = createTextModelRunner({
    runBailianCli: async () => { throw new Error('CLI should not run for strict tools'); },
    fetchImpl: async () => new Response(wrongTool, { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(
    wrongRunner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', tools: [{ type: 'function', function: { name: 'submit_visual_plan', parameters: { type: 'object' } } }], requiredToolName: 'submit_visual_plan' }),
    /调用了错误的工具/,
  );
});
