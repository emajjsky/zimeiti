export const creativeStages = [
  { id: 'planning', label: '规划', projectStage: 'PLANNING' },
  { id: 'research', label: '研究', projectStage: 'RESEARCH' },
  { id: 'master', label: '正文', projectStage: 'MASTER_WRITING' },
  { id: 'platform', label: '平台版本', projectStage: 'PLATFORM_ADAPTATION' },
  { id: 'visual', label: '配图', projectStage: 'VISUAL' },
  { id: 'layout', label: '排版', projectStage: 'LAYOUT' },
  { id: 'review', label: '审核', projectStage: 'REVIEW' },
];

const projectStageRoutes = {
  PLANNING: 'planning',
  RESEARCH: 'research',
  MASTER_WRITING: 'master',
  PLATFORM_ADAPTATION: 'platform',
  VISUAL: 'visual',
  LAYOUT: 'layout',
  REVIEW: 'review',
  COMPLETED: 'review',
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
  const currentIndex = creativeStages.findIndex((item) => item.id === stageRouteForProjectStage(projectStage));
  const requestedIndex = creativeStages.findIndex((item) => item.id === routeStage);
  return requestedIndex >= 0 && requestedIndex <= currentIndex;
}

export function validatePlanningDraft(planning) {
  const required = [
    ['title', '请填写选题标题'],
    ['angle', '请填写创作角度'],
    ['objective', '请填写创作目标'],
    ['targetAudience', '请填写目标受众'],
    ['coreMessage', '请填写核心表达'],
  ];
  const errors = required.flatMap(([field, message]) => String(planning?.[field] ?? '').trim() ? [] : [message]);
  if (!Array.isArray(planning?.targetPlatforms) || planning.targetPlatforms.length === 0) errors.push('请至少选择一个目标平台');
  return errors;
}
