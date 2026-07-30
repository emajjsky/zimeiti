export const creativeStages = [
  { id: 'planning', label: '规划', projectStage: 'PLANNING' },
  { id: 'master', label: '创作', projectStage: 'MASTER_WRITING' },
];

const projectStageRoutes = {
  PLANNING: 'planning',
  RESEARCH: 'research',
  MASTER_WRITING: 'master',
  PLATFORM_ADAPTATION: 'master',
  VISUAL: 'master',
  LAYOUT: 'master',
  REVIEW: 'master',
  COMPLETED: 'master',
};

export const planningFieldNames = [
  '选题标题',
  '题材',
  '创作角度',
  '创作目标',
  '目标受众',
  '核心表达',
  '目标平台',
  '时效',
  '计划发布时间',
  '来源与核验要求',
  '禁止表达与必须保留内容',
];

export function stageRouteForProjectStage(projectStage) {
  return projectStageRoutes[projectStage] ?? 'planning';
}

export function canOpenCreateStage(projectStage, routeStage) {
  const stageIndex = { planning: 0, research: 1, master: 1, platform: 1, visual: 1, layout: 1, review: 1 };
  const currentIndex = stageIndex[stageRouteForProjectStage(projectStage)];
  const requestedIndex = stageIndex[routeStage];
  return requestedIndex >= 0 && requestedIndex <= currentIndex;
}

export function validatePlanningDraft(planning) {
  const required = [
    ['title', '请填写选题标题'],
  ];
  const errors = required.flatMap(([field, message]) => String(planning?.[field] ?? '').trim() ? [] : [message]);
  if (!Array.isArray(planning?.targetPlatforms) || planning.targetPlatforms.length === 0) errors.push('请至少选择一个目标平台');
  return errors;
}
