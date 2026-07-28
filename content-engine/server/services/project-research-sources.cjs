const PROJECT_RESEARCH_SOURCES_VERSION = 'project-research-sources:1.0.0';

const allowedActions = new Set(['SEARCH_WEB', 'READ_LINK', 'ASK_USER']);

function researchSourceActions(plan) {
  const source = Array.isArray(plan?.nextActions) ? plan.nextActions : [];
  const actions = source.map((item, index) => {
    const action = String(item?.action ?? '');
    if (!allowedActions.has(action)) throw new Error(`不支持的研究动作：${action || '空动作'}。`);
    const purpose = String(item?.purpose ?? '').trim();
    const target = String(item?.target ?? '').trim();
    if (!purpose || !target) throw new Error('研究动作缺少目的或目标。');
    return { index, action, purpose, target };
  });
  if (!actions.length) throw new Error('研究计划没有可执行的来源动作。');
  const counts = {
    search: actions.filter((item) => item.action === 'SEARCH_WEB').length,
    read: actions.filter((item) => item.action === 'READ_LINK').length,
    askUser: actions.filter((item) => item.action === 'ASK_USER').length,
    automatic: actions.filter((item) => item.action !== 'ASK_USER').length,
  };
  return { actions, counts };
}

function normalizeSearchResults(action, results) {
  return (Array.isArray(results) ? results : []).slice(0, 5).flatMap((result) => {
    const normalized = normalizeCaptured(action, result);
    return normalized ? [normalized] : [];
  });
}

function normalizeReadResult(action, result) {
  const normalized = normalizeCaptured(action, result);
  if (!normalized) throw new Error('公开链接没有返回可保存的来源。');
  return normalized;
}

function normalizeCaptured(action, result) {
  const title = String(result?.title ?? '').trim();
  const rawUrl = String(result?.url ?? '').trim();
  if (!title || !rawUrl) return null;
  let url;
  try { url = new URL(rawUrl).toString(); }
  catch { return null; }
  return {
    actionIndex: action.index,
    action: action.action,
    purpose: action.purpose,
    target: action.target,
    status: 'CAPTURED',
    title: title.slice(0, 300),
    url,
    source: String(result?.source ?? new URL(url).hostname).trim().slice(0, 160),
    summary: String(result?.summary ?? '').trim().slice(0, 2_000),
    error: null,
  };
}

function manualSourceSnapshot(action) {
  return {
    actionIndex: action.index,
    action: action.action,
    purpose: action.purpose,
    target: action.target,
    status: 'NEEDS_USER',
    title: action.purpose,
    url: null,
    source: '用户补充',
    summary: action.target,
    error: null,
  };
}

function failedSourceSnapshot(action, error) {
  return {
    actionIndex: action.index,
    action: action.action,
    purpose: action.purpose,
    target: action.target,
    status: 'FAILED',
    title: action.purpose,
    url: action.action === 'READ_LINK' ? safeUrl(action.target) : null,
    source: action.action === 'SEARCH_WEB' ? '网页搜索' : '公开网页',
    summary: '',
    error: (error instanceof Error ? error.message : String(error || '来源读取失败。')).slice(0, 2_000),
  };
}

function dedupeSourceSnapshots(sources, limit = 20) {
  const seen = new Set();
  const output = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const key = source.url ? canonicalUrl(source.url) : `${source.actionIndex}:${source.status}:${source.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(source);
    if (output.length >= limit) break;
  }
  return output;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch { return String(value); }
}

function safeUrl(value) {
  try { return new URL(value).toString(); }
  catch { return null; }
}

function sourceRunView(row) {
  if (!row) return null;
  const snapshot = row.source_snapshot_json ?? {};
  return {
    id: row.id,
    status: row.status,
    request: snapshot.request ?? '执行研究来源动作',
    actionVersion: row.action_version_id,
    confirmation: {
      counts: snapshot.counts ?? { search: 0, read: 0, askUser: 0, automatic: 0 },
      tools: snapshot.tools ?? [],
      writeScope: '项目研究来源',
    },
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
  };
}

module.exports = {
  PROJECT_RESEARCH_SOURCES_VERSION,
  dedupeSourceSnapshots,
  failedSourceSnapshot,
  manualSourceSnapshot,
  normalizeReadResult,
  normalizeSearchResults,
  researchSourceActions,
  sourceRunView,
};
