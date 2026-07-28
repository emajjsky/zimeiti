export const projectCenterFilters = [
  { id: 'ALL', label: '全部' },
  { id: 'PLANNING', label: '待规划', stages: ['PLANNING'] },
  { id: 'RESEARCH', label: '研究中', stages: ['RESEARCH'] },
  { id: 'MASTER', label: '正文中', stages: ['MASTER_WRITING'] },
  { id: 'PLATFORM', label: '制作中', stages: ['PLATFORM_ADAPTATION', 'VISUAL', 'LAYOUT'] },
  { id: 'REVIEW', label: '待审核', stages: ['REVIEW'] },
  { id: 'COMPLETED', label: '已完成', stages: ['COMPLETED'] },
];

export function projectsForCenterFilter(projects, filter) {
  const stages = projectCenterFilters.find((item) => item.id === filter)?.stages;
  return stages ? projects.filter((project) => stages.includes(project.stage)) : projects;
}

export function selectedProjectIdForList(projects, currentId) {
  return projects.some((project) => project.id === currentId) ? currentId : projects[0]?.id ?? '';
}

export function projectCenterAction(stage) {
  return {
    PLANNING: '完成规划',
    RESEARCH: '继续研究',
    MASTER_WRITING: '继续正文',
    PLATFORM_ADAPTATION: '制作平台版本',
    VISUAL: '处理配图',
    LAYOUT: '继续排版',
    REVIEW: '完成审核',
    COMPLETED: '查看项目',
  }[stage];
}
