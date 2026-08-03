const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export function copyRunCompletion(watchedRun, run) {
  if (!watchedRun || !run || watchedRun.id !== run.id || watchedRun.action !== run.action) return { type: 'IGNORE' };
  if (!terminalStatuses.has(run.status)) return { type: 'WAIT' };
  if (run.status === 'FAILED') return { type: 'ERROR', message: run.error || '文案任务执行失败。' };
  if (run.status === 'SUCCEEDED' && run.action === 'GENERATE_DRAFT') return { type: 'SYNC_GENERATED_DRAFT' };
  return { type: 'COMPLETE' };
}
