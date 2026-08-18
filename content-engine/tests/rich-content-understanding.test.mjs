import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';

const moduleUrl = new URL('../server/services/rich-content-understanding.cjs', import.meta.url);

test('富内容执行器把正文、图片、视频和音频放进同一次 Omni 调用', async () => {
  assert.equal(existsSync(moduleUrl), true, '缺少统一富内容执行器');
  const { normalizeRichContentPackage, buildRichContentOmniArgs } = await import(moduleUrl);
  const content = normalizeRichContentPackage({
    text: { title: '标题', body: '正文', metadata: { source: 'upload' } },
    media: [
      { kind: 'IMAGE', source: 'C:/uploads/a.png', label: '封面' },
      { kind: 'IMAGE', source: 'C:/uploads/a.png', label: '重复项' },
      { kind: 'VIDEO', source: 'C:/uploads/b.mp4' },
      { kind: 'AUDIO', source: 'C:/uploads/c.wav' },
    ],
  });

  assert.equal(content.media.length, 3);
  const args = buildRichContentOmniArgs({
    model: 'qwen3.8-max',
    system: '联合理解',
    message: JSON.stringify(content.text),
    content,
    maxTokens: 3200,
  });
  assert.equal(args.filter((item) => item === '--image').length, 1);
  assert.equal(args.filter((item) => item === '--video').length, 1);
  assert.equal(args.filter((item) => item === '--audio').length, 1);
  assert.deepEqual(args.slice(-5), ['--text-only', '--max-tokens', '3200', '--output', 'json']);
});

test('富内容执行器从 CLI 包装结果提取并校验任务 JSON', async () => {
  assert.equal(existsSync(moduleUrl), true, '缺少统一富内容执行器');
  const { parseStructuredOmniOutput } = await import(moduleUrl);
  const schema = z.object({ summary: z.string().min(1) });
  const parsed = parseStructuredOmniOutput(JSON.stringify({
    choices: [{ message: { content: '```json\n{"summary":"完成"}\n```' } }],
  }), schema, '测试任务');
  assert.deepEqual(parsed, { summary: '完成' });
  assert.throws(() => parseStructuredOmniOutput('{}', schema, '测试任务'), /没有返回可用内容/);
});
