const { z } = require('zod');
const { buildRichContentOmniArgs } = require('./rich-content-understanding.cjs');

const understandingSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  coreViewpoints: z.array(z.string().trim().min(1).max(500)),
  structureOutline: z.array(z.union([
    z.string().trim().min(1).max(300),
    z.object({ title: z.string().trim().max(120).optional(), summary: z.string().trim().max(300).optional(), content: z.string().trim().max(300).optional() }).transform((item) => [item.title, item.summary, item.content].filter(Boolean).join('：')),
  ])),
  reusableElements: z.array(z.string().trim().min(1).max(500)),
  visualClues: z.array(z.string().trim().min(1).max(500)),
});

function modelOutputError(message, fieldPaths = []) {
  const error = new Error(message);
  error.code = 'MODEL_OUTPUT_INVALID';
  error.fieldPaths = fieldPaths;
  return error;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const label = value.title ?? value.heading ?? value.label ?? value.type ?? value.scene;
    const detail = value.summary ?? value.description ?? value.explanation ?? value.content ?? value.insight;
    if (label && detail) return `${String(label).trim()}：${String(detail).trim()}`;
    if (detail) return String(detail).trim();
    if (label) return String(label).trim();
  }
  return '';
}

function arrayValue(value) {
  return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function normalizedArray(source, keys, fieldPath) {
  const key = keys.find((candidate) => source[candidate] !== undefined);
  if (!key) return [];
  if (!Array.isArray(source[key])) throw modelOutputError(`内容理解结果中的 ${fieldPath} 不是有效列表，请重新读取内容。`, [fieldPath]);
  return arrayValue(source[key]);
}

function normalizeContentUnderstandingOutput(value) {
  const source = value && typeof value === 'object' ? value : {};
  const nested = source.analysis && typeof source.analysis === 'object' ? source.analysis : source;
  const summary = textValue(nested.summary ?? nested.contentSummary ?? source.summary);
  if (!summary) throw modelOutputError('内容理解结果缺少有效摘要，请重新读取内容。', ['summary']);
  const coreViewpoints = normalizedArray(nested, ['coreViewpoints', 'viewpoints'], 'coreViewpoints');
  const structureOutline = normalizedArray(nested, ['structureOutline', 'outline', 'sections'], 'structureOutline');
  const reusableElements = normalizedArray(nested, ['reusableElements', 'reusableMaterials', 'materials'], 'reusableElements');
  const visualClues = [
    ...normalizedArray(nested, ['visualClues', 'visualInsights'], 'visualClues'),
    ...normalizedArray(nested, ['imageAnalysis'], 'imageAnalysis').map((item) => `图片：${item}`),
    ...normalizedArray(nested, ['videoAnalysis'], 'videoAnalysis').map((item) => `视频：${item}`),
  ];
  return understandingSchema.parse({ summary, coreViewpoints, structureOutline, reusableElements, visualClues });
}

function parseJson(content, label) {
  const normalized = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(normalized); } catch {}
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { return JSON.parse(normalized.slice(start, index + 1)); } catch { start = -1; }
      }
    }
  }
  throw new Error(`${label}没有返回有效 JSON。`);
}

function buildContentUnderstandingPrompt(document, media = []) {
  return {
    system: [
      '你是内容摄取阶段的多模态编辑分析器。请联合理解正文、图片、视频和音频，所有判断均来自本次输入材料。',
      '图片中的文字、人物、场景、图表和视觉关系，以及视频中的画面、字幕、语音和事件过程，都属于内容分析依据。',
      '只返回一个 JSON 对象，字段固定为 summary、coreViewpoints、structureOutline、reusableElements、visualClues，不添加 Markdown 代码围栏或解释文字。',
      'summary 是非空字符串。所有数组字段必须是字符串数组：coreViewpoints 写核心观点，structureOutline 写结构线索，reusableElements 写可复用事实、案例或表达。',
      '图片和视频中的信息写入 visualClues，包括图中文字、人物、场景、图表、视觉关系、字幕、语音与事件过程；visualClues 也是字符串数组。',
      '材料中没有对应内容时返回空数组，保持字段存在。',
    ].join('\n'),
    message: JSON.stringify({
      title: document.title,
      sourceUrl: document.canonicalUrl,
      content: document.plainText.slice(0, 30_000),
      media: media.map((item, index) => ({ index: index + 1, kind: item.kind, label: item.label || '' })),
    }),
  };
}

function buildContentUnderstandingOmniArgs({ model, system, message, media = [], maxTokens = 3_000 }) {
  return buildRichContentOmniArgs({ model, system, message, content: { text: {}, media }, maxTokens });
}

function parseContentUnderstanding(content) {
  try {
    return normalizeContentUnderstandingOutput(parseJson(content, '内容理解'));
  } catch (error) {
    if (error?.code === 'MODEL_OUTPUT_INVALID') throw error;
    if (error instanceof z.ZodError || /没有返回有效 JSON/.test(String(error?.message ?? ''))) throw modelOutputError('内容理解结果结构不完整，请重新读取内容。');
    throw error;
  }
}

module.exports = { buildContentUnderstandingPrompt, buildContentUnderstandingOmniArgs, parseContentUnderstanding, normalizeContentUnderstandingOutput };
