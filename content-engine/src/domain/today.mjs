export function formatTodayTitle(value = new Date(), timeZone = 'Asia/Shanghai') {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return month && day ? `今天，${Number(month)} 月 ${Number(day)} 日` : '今天';
}

export function projectTaskMeta(status) {
  const values = {
    BRIEF: { prefix: '完善创作设定', action: '去设定', view: 'create' },
    WRITING: { prefix: '继续文案', action: '继续编辑', view: 'create' },
    VISUAL: { prefix: '完成配图', action: '去处理', view: 'create' },
    VIDEO: { prefix: '处理视频任务', action: '去处理', view: 'create' },
    REVIEW: { prefix: '审核内容', action: '去审核', view: 'create' },
    SCHEDULED: { prefix: '确认发布安排', action: '去发布', view: 'publish' },
    PARTIALLY_PUBLISHED: { prefix: '完成剩余发布', action: '去发布', view: 'publish' },
    PUBLISHED: { prefix: '回填内容数据', action: '去复盘', view: 'review' },
    RETROSPECTIVE: { prefix: '复盘内容表现', action: '去复盘', view: 'review' },
  };
  return values[status] ?? null;
}
