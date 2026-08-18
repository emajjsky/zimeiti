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

test('公众号生图接受用户提示词，但画幅仍由服务端决定', () => {
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

test('公众号生图对 DataInspectionFailed 返回稳定业务错误', () => {
  const { buildBailianVisualGenerationError, isBailianDataInspectionFailure } = loadVisualGenerationService();
  const raw = new Error('{"error":{"code":1,"message":"Input data may contain inappropriate content. For details, see https://help.aliyun.com/zh/model-studio/error-code#inappropriate-content","http_status":400,"api_code":"DataInspectionFailed","request_id":"req-123"}}');
  assert.equal(isBailianDataInspectionFailure(raw), true);
  const failure = buildBailianVisualGenerationError(raw, { retried: true });
  assert.equal(failure.statusCode, 400);
  assert.equal(failure.code, 'IMAGE_CONTENT_REJECTED');
  assert.match(failure.message, /仍未通过/);
  assert.deepEqual(failure.details, { apiCode: 'DataInspectionFailed', requestId: 'req-123' });
});

test('公众号生图提示词清理会去掉高风险词并保留主体场景', () => {
  const { sanitizeBailianVisualPrompt, isBailianDataInspectionFailure } = loadVisualGenerationService();
  const prompt = '明亮的现代会议室，大屏幕上播放着一段精致的数据视频：中国地图上华东区高亮显示，动态增长曲线浮现，旁边伴有简洁的文字结论，参会者专注观看并点头。';
  const sanitized = sanitizeBailianVisualPrompt(prompt);
  assert.match(sanitized, /现代会议室/);
  assert.match(sanitized, /动态增长曲线/);
  assert.doesNotMatch(sanitized, /中国地图|二维码|水印|logo|签名/);
  assert.equal(isBailianDataInspectionFailure(new Error('network down')), false);
});

test('公众号生图使用用户编辑后的正向提示词', async () => {
  const { resolveWechatVisualGenerationSpec } = loadVisualGenerationService();
  const result = await resolveWechatVisualGenerationSpec({
    input: { platform: 'WECHAT', visualItemId: bodyItem.id, prompt: 'bright room, an older adult holds a phone, natural window light, clear subject', assetIds: [] },
    draft: { title: 'test', visualPlan: { plan: [bodyItem], styleProfile: { preset: 'FRESH_EDITORIAL', customPrompt: '' } } },
  });
  assert.equal(result.prompt, 'bright room, an older adult holds a phone, natural window light, clear subject');
  assert.equal(result.size, '4:3');
});
