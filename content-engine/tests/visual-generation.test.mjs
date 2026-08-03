import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function loadVisualGenerationService() {
  try {
    return require('../server/services/visual-generation.cjs');
  } catch (error) {
    assert.fail(`公众号生图缺少独立的服务端契约：${error instanceof Error ? error.message : String(error)}`);
  }
}

const bodyItem = {
  id: 'wechat-body-1',
  role: 'BODY',
  title: '整理研究资料',
  placement: '正文第二段后',
  purpose: '展示创作者如何筛选事实依据',
  visualType: 'SCENE',
  focus: '创作者在桌前对照采访照片、研究笔记和事实清单',
  avoidConcepts: [],
  searchQueries: ['创作者 整理 研究资料'],
  generationMode: 'ILLUSTRATION',
  informationPoints: ['对照照片与笔记筛选文章依据'],
  stylePreset: 'INHERIT',
  templatePreset: 'WIDE_CONTEXT',
  sourceExcerpt: '创作者在桌前整理采访照片、研究笔记和事实依据。',
  contentBlocks: [],
  references: [],
  prompt: '旧客户端保存的任意提示词',
  size: '1:1',
  assetId: null,
};

test('公众号生图请求只接受配图项 ID，不接受客户端提示词和画幅', () => {
  const { parseVisualGenerationRequest } = loadVisualGenerationService();
  assert.throws(() => parseVisualGenerationRequest({
    platform: 'WECHAT',
    visualItemId: bodyItem.id,
    prompt: '绕过服务端的任意提示词',
    size: '1:1',
    assetIds: [],
  }), /公众号生图请求不能提交提示词或画幅/);
  assert.deepEqual(parseVisualGenerationRequest({
    platform: 'WECHAT',
    visualItemId: bodyItem.id,
    assetIds: [],
  }), {
    platform: 'WECHAT',
    visualItemId: bodyItem.id,
    assetIds: [],
  });
});

test('公众号最终生图参数从当前草稿方案重新编译并固定正文为 4:3', async () => {
  const { resolveWechatVisualGenerationSpec } = loadVisualGenerationService();
  const result = await resolveWechatVisualGenerationSpec({
    input: { platform: 'WECHAT', visualItemId: bodyItem.id, assetIds: [] },
    draft: {
      title: '怎样建立可靠的研究工作流',
      visualPlan: {
        plan: [bodyItem],
        styleProfile: { preset: 'FRESH_EDITORIAL', customPrompt: '统一使用柔和北向窗光' },
      },
    },
  });
  assert.equal(result.size, '4:3');
  assert.match(result.prompt, /创作者在桌前对照采访照片/);
  assert.match(result.prompt, /统一使用柔和北向窗光/);
  assert.doesNotMatch(result.prompt, /旧客户端保存的任意提示词/);
});
