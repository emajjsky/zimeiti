export const draftWorkflowSteps = Object.freeze([
  Object.freeze({ id: 'preparation', label: '内容准备', stage: 'PREPARING' }),
  Object.freeze({ id: 'copy', label: '公众号正文', stage: 'WECHAT_WRITING' }),
  Object.freeze({ id: 'visual', label: '公众号配图', stage: 'WECHAT_IMAGING' }),
  Object.freeze({ id: 'layout', label: '公众号排版', stage: 'WECHAT_LAYOUT' }),
  Object.freeze({ id: 'drafts', label: '完成草稿', stage: 'DRAFT_READY' }),
]);

const routeByStage = new Map(draftWorkflowSteps.map(({ id, stage }) => [stage, id]));
const routeOrder = new Map(draftWorkflowSteps.map(({ id }, index) => [id, index]));
const imageLimits = Object.freeze({ WECHAT: 12, XIAOHONGSHU: 9, WEIBO: 9 });

export function routeForProjectStage(stage) {
  const route = routeByStage.get(stage);
  if (!route) throw new Error(`不支持的项目阶段：${stage}`);
  return route;
}

export function canOpenDraftStep(stage, route) {
  const currentRoute = routeByStage.get(stage);
  const currentIndex = routeOrder.get(currentRoute);
  const requestedIndex = routeOrder.get(route);
  if (currentIndex === undefined || requestedIndex === undefined) return false;
  return requestedIndex <= currentIndex;
}

export function draftImageLimit(platform) {
  if (!Object.hasOwn(imageLimits, platform)) throw new Error(`不支持的平台：${platform}`);
  return imageLimits[platform];
}
