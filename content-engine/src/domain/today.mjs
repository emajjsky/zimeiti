export function formatTodayTitle(value = new Date(), timeZone = 'Asia/Shanghai') {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return month && day ? `今天，${Number(month)} 月 ${Number(day)} 日` : '今天';
}

export function projectTaskMeta(stage) {
  const values = {
    PLANNING: { prefix: '完成规划', action: '去规划', view: 'create' },
    RESEARCH: { prefix: '继续研究', action: '去研究', view: 'create' },
    MASTER_WRITING: { prefix: '继续正文', action: '去写作', view: 'create' },
    PLATFORM_ADAPTATION: { prefix: '制作平台版本', action: '去制作', view: 'create' },
    VISUAL: { prefix: '处理配图', action: '去配图', view: 'create' },
    LAYOUT: { prefix: '继续排版', action: '去排版', view: 'create' },
    REVIEW: { prefix: '完成审核', action: '去审核', view: 'create' },
  };
  return values[stage] ?? null;
}

const projectStageLabels = {
  PLANNING: '待规划',
  RESEARCH: '研究中',
  MASTER_WRITING: '正文中',
  PLATFORM_ADAPTATION: '平台制作中',
  VISUAL: '配图中',
  LAYOUT: '排版中',
  REVIEW: '待审核',
};

export function projectTaskEntries(projects) {
  return projects.flatMap((project) => {
    const meta = projectTaskMeta(project.stage);
    if (!meta) return [];
    return [{
      id: `project:${project.id}`,
      projectId: project.id,
      title: `${meta.prefix}：${project.title}`,
      sub: `${projectStageLabels[project.stage] ?? project.stage} · 更新于 ${project.updatedAt}`,
      action: meta.action,
      view: meta.view,
    }];
  });
}

export function completedProjects(projects) {
  return projects.filter((project) => project.stage === 'COMPLETED');
}
