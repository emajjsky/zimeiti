const actionLabels = {
  GENERATE_DRAFT: '生成正文',
  REVISE_SELECTION: '修改选中内容',
  POLISH_EXISTING_DRAFT: '润色',
  EXPAND_DRAFT: '扩写',
  SHORTEN_DRAFT: '压缩',
  RESTRUCTURE_DRAFT: '重构',
  REVIEW_CANDIDATE: '查看并采用',
};

const revisionActions = [
  'POLISH_EXISTING_DRAFT',
  'EXPAND_DRAFT',
  'SHORTEN_DRAFT',
  'RESTRUCTURE_DRAFT',
];

export function copyActionRequest(action, note = '') {
  const request = {
    GENERATE_DRAFT: '生成正文',
    REVISE_SELECTION: '修改选中内容',
    POLISH_EXISTING_DRAFT: '润色当前正文',
    EXPAND_DRAFT: '扩写当前正文',
    SHORTEN_DRAFT: '压缩当前正文',
    RESTRUCTURE_DRAFT: '重构当前正文',
  }[action];
  if (!request) throw new Error('未知的正文动作。');
  return note.trim() ? `${request}：${note.trim()}` : request;
}

export function copyActionPanelState({ hasBody, hasSelection, hasCandidate }) {
  if (hasCandidate) return { primary: { action: 'REVIEW_CANDIDATE', label: actionLabels.REVIEW_CANDIDATE }, quickActions: [] };
  if (hasSelection) return { primary: { action: 'REVISE_SELECTION', label: actionLabels.REVISE_SELECTION }, quickActions: [] };
  if (!hasBody) return { primary: { action: 'GENERATE_DRAFT', label: actionLabels.GENERATE_DRAFT }, quickActions: [] };
  return {
    primary: { action: 'POLISH_EXISTING_DRAFT', label: actionLabels.POLISH_EXISTING_DRAFT },
    quickActions: revisionActions.map((action) => ({ action, label: actionLabels[action] })),
  };
}
