const { z } = require('zod');

const TITLE_RECOMMENDATION_SCOPE = 'TITLE_RECOMMENDATION';
const TITLE_RECOMMENDATION_OPERATION = 'TITLE_RECOMMENDATION';
const titleRecommendationSchema = z.object({
  recommendations: z.array(z.object({
    title: z.string().trim().min(4).max(300),
    angle: z.string().trim().min(1).max(500),
  })).min(3).max(6),
});

function buildTitleRecommendationPrompt({ draft, assets = [] }) {
  return {
    system: [
      '你是公众号标题编辑。根据当前完整成稿和已选配图，提出准确、具体、有传播力的标题候选。',
      '标题必须忠实于正文，不夸大、不虚构、不制造正文没有的结论；每个候选突出不同切入角度。',
      '只返回 JSON：{"recommendations":[{"title":"标题","angle":"切入角度"}]}，不要 Markdown、解释或额外字段。',
    ].join('\n'),
    message: JSON.stringify({
      task: '为当前公众号成稿提供标题候选',
      draft: { title: draft?.title ?? '', body: draft?.body ?? '' },
      selectedMedia: assets.map((asset) => ({ kind: asset.kind, title: asset.title })),
    }),
  };
}

function parseTitleRecommendations(content) {
  const normalized = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(normalized); } catch { throw new Error('标题建议模型返回的内容不是有效 JSON。'); }
  return titleRecommendationSchema.parse(parsed).recommendations;
}

module.exports = { TITLE_RECOMMENDATION_SCOPE, TITLE_RECOMMENDATION_OPERATION, buildTitleRecommendationPrompt, parseTitleRecommendations };
