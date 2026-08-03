import assert from 'node:assert/strict';
import test from 'node:test';

const { createTextModelRunner } = await import('../server/services/text-model.cjs');

const payload = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });

test('百炼策略通过 CLI 返回标准文本结果', async () => {
  let args;
  const runner = createTextModelRunner({ runBailianCli: async (nextArgs) => { args = nextArgs; return payload; } });
  const result = await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', maxTokens: 6_000, temperature: 0.15 });
  assert.deepEqual(result, { content: '{"ok":true}', inputTokens: 12, outputTokens: 8 });
  assert.equal(args[args.indexOf('--max-tokens') + 1], '6000');
  assert.equal(args[args.indexOf('--temperature') + 1], '0.15');
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

test('百炼严格工具调用会传递工具定义并只读取指定工具参数', async () => {
  let args;
  const toolPayload = JSON.stringify({
    choices: [{ message: { content: '', tool_calls: [{ type: 'function', function: { name: 'submit_visual_plan', arguments: '{"strategy":"完整方案","items":[]}' } }] } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  });
  const tool = { type: 'function', function: { name: 'submit_visual_plan', parameters: { type: 'object' } } };
  const runner = createTextModelRunner({ runBailianCli: async (nextArgs) => { args = nextArgs; return toolPayload; } });
  const result = await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', tools: [tool], requiredToolName: 'submit_visual_plan' });
  assert.deepEqual(result.toolCall, { name: 'submit_visual_plan', arguments: '{"strategy":"完整方案","items":[]}' });
  assert.equal(result.content, result.toolCall.arguments);
  assert.deepEqual(JSON.parse(args[args.indexOf('--tool') + 1]), tool);
});

test('严格工具调用拒绝普通文本和错误工具，不把文本当结构化结果', async () => {
  const plainRunner = createTextModelRunner({ runBailianCli: async () => payload });
  await assert.rejects(
    plainRunner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', tools: [], requiredToolName: 'submit_visual_plan' }),
    (error) => error.message.includes('必须且只能调用一次 submit_visual_plan') && error.inputTokens === 12 && error.outputTokens === 8,
  );
  const wrongTool = JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'other_tool', arguments: '{}' } }] } }] });
  const wrongRunner = createTextModelRunner({ runBailianCli: async () => wrongTool });
  await assert.rejects(
    wrongRunner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message', requiredToolName: 'submit_visual_plan' }),
    /调用了错误的工具/,
  );
});
