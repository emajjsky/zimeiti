const { DEFAULT_WECHAT_LAYOUT_RULES } = require('./wechat-layout-renderer.cjs');

const WECHAT_LAYOUT_DESIGN_SCOPE = 'WECHAT_LAYOUT_DESIGN';
const WECHAT_LAYOUT_DESIGN_PROMPT_VERSION = 'wechat-layout-design:1';

const blockRoles = new Set(['lead', 'key-judgement', 'section-summary', 'quote', 'normal']);
const blockVariants = new Set(['accent-line', 'callout', 'card', 'plain']);
const inlineTypes = new Set(['strong', 'strong-accent', 'marker', 'code']);

function stripCodeFence(value) {
  return String(value ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function paragraphCount(body) {
  return String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).length;
}

function clampText(value, max) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function safeInlineText(value) {
  const text = clampText(value, 80);
  if (text.length < 2) return '';
  if (/[<>]/.test(text)) return '';
  return text;
}

function normalizeBlock(input, maxParagraph) {
  const paragraphIndex = Number(input?.paragraphIndex);
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1 || paragraphIndex > maxParagraph) return null;
  const role = blockRoles.has(input?.role) ? input.role : 'normal';
  const variant = blockVariants.has(input?.variant) ? input.variant : 'plain';
  return { paragraphIndex, role, variant };
}

function normalizeInlineMark(input) {
  const text = safeInlineText(input?.text);
  if (!text) return null;
  const type = inlineTypes.has(input?.type) ? input.type : 'strong';
  return { text, type };
}

function parseWechatLayoutDesignContent(content, context = {}) {
  let parsed;
  try { parsed = JSON.parse(stripCodeFence(content)); }
  catch { throw new Error('智能精排模型返回的内容不是有效 JSON。'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('智能精排模型返回的内容不是有效对象。');
  const maxParagraph = Math.max(0, Number(context.paragraphCount ?? 0));
  const seenBlocks = new Set();
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks.flatMap((item) => {
    const block = normalizeBlock(item, maxParagraph);
    if (!block || seenBlocks.has(block.paragraphIndex)) return [];
    seenBlocks.add(block.paragraphIndex);
    return [block];
  }).slice(0, 24) : [];
  const seenMarks = new Set();
  const inlineMarks = Array.isArray(parsed.inlineMarks) ? parsed.inlineMarks.flatMap((item) => {
    const mark = normalizeInlineMark(item);
    const key = mark ? `${mark.text}:${mark.type}` : '';
    if (!mark || seenMarks.has(key)) return [];
    seenMarks.add(key);
    return [mark];
  }).slice(0, 80) : [];
  return {
    schemaVersion: 1,
    notes: clampText(parsed.notes, 240),
    blocks,
    inlineMarks,
  };
}

function buildWechatLayoutDesignPrompt({ title, body, assets = [], templateRules = DEFAULT_WECHAT_LAYOUT_RULES, instruction = '' }) {
  const paragraphs = String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return {
    promptVersion: WECHAT_LAYOUT_DESIGN_PROMPT_VERSION,
    system: [
      '你是 WECHAT_LAYOUT_DESIGN 智能精排设计师。',
      '只返回 JSON 对象，禁止返回 HTML、CSS、Markdown 正文、解释文本或额外字段。',
      '你不能改写正文，只能为现有段落和现有短语添加排版语义标注。',
      'blocks[].paragraphIndex 从 1 开始，对应用户正文段落。role 只能是 lead/key-judgement/section-summary/quote/normal。',
      'blocks[].variant 只能是 accent-line/callout/card/plain。',
      'inlineMarks[].type 只能是 strong/strong-accent/marker/code；inlineMarks[].text 必须是正文里真实出现的短语。',
      '重点标注要克制：只标注真正影响理解的判断、关键词、数据或行动词，不要整段加粗。',
    ],
    user: JSON.stringify({
      title: String(title ?? '').trim(),
      paragraphCount: paragraphs.length,
      paragraphs: paragraphs.map((text, index) => ({ index: index + 1, text })),
      assets: assets.map((asset, index) => ({ index: index + 1, role: asset.role, assetId: asset.assetId })),
      templateRules,
      instruction: String(instruction ?? '').trim(),
      outputSchema: {
        schemaVersion: 1,
        notes: '简短说明',
        blocks: [{ paragraphIndex: 1, role: 'lead', variant: 'accent-line' }],
        inlineMarks: [{ text: '正文中真实短语', type: 'strong-accent' }],
      },
    }),
  };
}

module.exports = {
  WECHAT_LAYOUT_DESIGN_SCOPE,
  WECHAT_LAYOUT_DESIGN_PROMPT_VERSION,
  buildWechatLayoutDesignPrompt,
  parseWechatLayoutDesignContent,
  paragraphCount,
};
