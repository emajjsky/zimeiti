const { z } = require('zod');
const { VOICE_ARCHETYPES, voiceRulesSchema } = require('./accountVoices.cjs');

const MAX_ARTICLE_CHARS = 30_000;
const archetypeSlugs = VOICE_ARCHETYPES.map((item) => item.slug);

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
  editedRules: voiceRulesSchema,
  ruleSummary: z.string().trim().min(1).max(1_000),
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
  const example = {
    name: '我的文章表达',
    archetypeSlug: 'say-it-through',
    identityText: '以账号作者真实提供的材料和判断为边界，不虚构身份与亲历。',
    audienceText: '希望快速理解复杂问题的普通读者。',
    readerTakeawayText: '读完知道判断依据和适用边界。',
    editedRules: {
      opening: '从明确判断或可验证事实进入。',
      reasoning: '先给判断，再拆理由、证据与边界。',
      rhythm: '短中句交替，一段只推进一个意思。',
      ending: '自然收束，不强制互动。',
      identityBoundary: '不虚构账号作者的经历、身份、立场或资料。',
      audience: '希望快速理解复杂问题的普通读者。',
      readerTakeaway: '读完知道判断依据和适用边界。',
      allowedPhrases: ['先把事实放在前面'],
      bannedPhrases: ['很多人会问', '今天我们就来'],
      bannedStructures: ['emoji 小标题', '强制互动结尾'],
    },
    ruleSummary: '先判断后展开，节奏克制，结尾自然收束。',
  };
  return {
    system: [
      '你是内容编辑，任务是把用户本人或已授权的公开文章提炼成可编辑的“账号表达规则”。',
      '这不是模仿任务：不得模仿特定作者，不得复写、改写或摘抄文章全文，不要保留独特句子、段落或专有比喻。',
      '只总结可泛化的组织方式、节奏、论证、收束、常用表达偏好和应避免的套话。',
      '不得凭空编造作者身份、职业、亲历、观点或读者画像；身份边界必须保守。',
      `只输出 JSON，不要 Markdown。JSON 形状：${JSON.stringify(example)}`,
    ].join('\n'),
    message: `文章标题：${article.title}\n来源：${article.source}\n链接：${article.url}\n\n文章正文（仅本次提炼使用，不要在结果中复写）：\n${text}`,
  };
}

module.exports = {
  MAX_ARTICLE_CHARS,
  accountVoiceCalibrationDraftInput,
  buildVoiceCalibrationPrompt,
  parseVoiceCalibrationDraft,
};
