import assert from 'node:assert/strict';
import test from 'node:test';

const { createTextModelRunner } = await import('../server/services/text-model.cjs');

const payload = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });

test('百炼策略通过 CLI 返回标准文本结果', async () => {
  const runner = createTextModelRunner({ runBailianCli: async () => payload });
  const result = await runner.runText({ provider: 'BAILIAN_CLI', apiKey: 'secret', model: 'qwen-plus', system: 'system', message: 'message' });
  assert.deepEqual(result, { content: '{"ok":true}', inputTokens: 12, outputTokens: 8 });
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
