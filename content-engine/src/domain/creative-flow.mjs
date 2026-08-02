import { draftWorkflowSteps } from './draft-workflow.mjs';

export const creativeStages = draftWorkflowSteps.map(({ id, label, stage }) => ({ id, label, projectStage: stage }));

const projectStageRoutes = {
  PLANNING: 'preparation',
  RESEARCH: 'preparation',
  MASTER_WRITING: 'copy',
  PLATFORM_ADAPTATION: 'copy',
  VISUAL: 'visual',
  LAYOUT: 'layout',
  REVIEW: 'layout',
  COMPLETED: 'drafts',
  PREPARING: 'preparation',
  WECHAT_WRITING: 'copy',
  WECHAT_IMAGING: 'visual',
  WECHAT_LAYOUT: 'layout',
  DRAFT_READY: 'drafts',
};

export const planningFieldNames = [
  '选题标题',
  '题材',
  '创作角度',
  '创作目标',
  '目标受众',
  '核心表达',
  '时效',
  '计划发布时间',
  '来源与核验要求',
  '禁止表达与必须保留内容',
];

export function stageRouteForProjectStage(projectStage) {
  return projectStageRoutes[projectStage] ?? 'preparation';
}

export function canOpenCreateStage(projectStage, routeStage) {
  const stageIndex = { preparation: 0, copy: 1, visual: 2, layout: 3, drafts: 4 };
  const currentIndex = stageIndex[stageRouteForProjectStage(projectStage)];
  const requestedIndex = stageIndex[routeStage];
  return requestedIndex >= 0 && requestedIndex <= currentIndex;
}

export function validatePlanningDraft(planning) {
  const required = [
    ['title', '请填写选题标题'],
  ];
  const errors = required.flatMap(([field, message]) => String(planning?.[field] ?? '').trim() ? [] : [message]);
  return errors;
}
