const { z } = require('zod');
const { VOICE_ARCHETYPES, voiceRulesSchema } = require('./accountVoices.cjs');

const MAX_ARTICLE_CHARS = 30_000;
const archetypeSlugs = VOICE_ARCHETYPES.map((item) => item.slug);
const diagnosticDimension = z.enum(['标题', '开篇钩子', '论证推进', '证据方式', '段落节奏', '语言颗粒', '读者关系', '收束方式']);

const richVoiceRulesSchema = voiceRulesSchema.extend({
  hookPatterns: z.array(z.string().trim().min(1).max(240)).min(2).max(8),
  argumentPattern: z.string().trim().min(12).max(1_000),
  evidenceStyle: z.string().trim().min(12).max(1_000),
  paragraphPattern: z.string().trim().min(12).max(1_000),
  languageTexture: z.string().trim().min(12).max(1_000),
  readerRelationship: z.string().trim().min(12).max(1_000),
  titlePatterns: z.array(z.string().trim().min(1).max(240)).min(2).max(8),
  closingStyle: z.string().trim().min(12).max(1_000),
});

const accountVoiceCalibrationDraftInput = z.object({
  sourceUrl: z.string().url().max(2_000),
  confirmedLicensed: z.boolean().refine((value) => value, '请确认你拥有这篇文章的使用权或已获授权。'),
});

const voiceCalibrationDraftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  archetypeSlug: z.enum(archetypeSlugs),
  identityText: z.string().trim().min(1).max(600),
  audienceText: z.string().trim().min(1).max(600),
  readerTakeawayText: z.string().trim().min(1).max(600),
  editedRules: richVoiceRulesSchema,
  ruleSummary: z.string().trim().min(1).max(1_000),
  analysis: z.object({
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    voiceFingerprint: z.string().trim().min(8).max(240),
    diagnostics: z.array(z.object({
      dimension: diagnosticDimension,
      finding: z.string().trim().min(12).max(400),
      evidence: z.string().trim().min(12).max(400),
    })).min(6).max(8).superRefine((items, context) => {
      if (new Set(items.map((item) => item.dimension)).size !== items.length) context.addIssue({ code: 'custom', message: '诊断维度不能重复。' });
    }),
  }),
});

function cleanJson(content) {
  return String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseVoiceCalibrationDraft(content) {
  let value;
  try { value = JSON.parse(cleanJson(content)); }
  catch { throw new Error('账号声音提炼结果不是有效 JSON。'); }
  return voiceCalibrationDraftSchema.parse(value);
}

function buildVoiceCalibrationPrompt(article) {
  const text = String(article.text || '').trim().slice(0, MAX_ARTICLE_CHARS);
  if (text.length < 120) throw new Error('没有读取到足够的正文，暂时无法提炼账号声音。');
  return {
    system: [
      '你是内容编辑，任务是把用户本人或已授权的公开文章提炼成可编辑的“账号表达规则”。',
      '这不是模仿任务：不得模仿特定作者，不得复写、改写或摘抄文章全文，不要保留独特句子、段落或专有比喻。',
      '必须先做样本诊断，再生成规则。不得输出脱离样本的通用规则；“先判断再展开”“短句”“自然收束”这类描述只有在文章确实呈现该特征时才可使用。',
      '诊断要覆盖标题、开篇钩子、论证推进、证据方式、段落节奏、语言颗粒、读者关系、收束方式中的至少六项。每项的 evidence 只描述文章中可观察到的结构或位置，不得摘抄原句。',
      '在 editedRules 中写可执行的规则：除开篇、展开、节奏、收束外，还必须提炼钩子套路、论证模式、证据习惯、段落组织、语言颗粒、与读者的关系、标题套路和收束动作。',
      '不得凭空编造作者身份、职业、亲历、观点或读者画像；身份边界必须保守。',
      '单篇样本的 confidence 必须为 LOW；不要假装已得到稳定的长期账号风格。',
      '只输出 JSON，不要 Markdown。字段必须包含：name、archetypeSlug、identityText、audienceText、readerTakeawayText、editedRules、ruleSummary、analysis。analysis 必须包含 confidence、voiceFingerprint、diagnostics；diagnostics 项包含 dimension、finding、evidence。',
    ].join('\n'),
    message: `文章标题：${article.title}\n来源：${article.source}\n链接：${article.url}\n\n文章正文（仅本次提炼使用，不要在结果中复写）：\n${text}`,
  };
}

function buildVoiceCalibrationRepairPrompt(system, validationError) {
  return `${system}\n上一次输出不符合结构化账号声音诊断要求。请只返回完整修正后的 JSON，不得删减 diagnostics 或扩展执行规则。校验错误：${validationError}`;
}

module.exports = {
  MAX_ARTICLE_CHARS,
  accountVoiceCalibrationDraftInput,
  buildVoiceCalibrationPrompt,
  buildVoiceCalibrationRepairPrompt,
  parseVoiceCalibrationDraft,
};
