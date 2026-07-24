import type { ContentProject, IntelligenceItem, IntelligenceSource, Platform, TopicCandidate } from '../domain/content';
import { webState } from './webApi';

const key = 'content-engine-prototype-v1';

export interface LocalState {
  workspace: WorkspaceProfile;
  feishuTemplate: FeishuLibraryTemplate;
  sources: IntelligenceSource[];
  intelligence: IntelligenceItem[];
  topics: TopicCandidate[];
  projects: ContentProject[];
}

export interface WorkspaceProfile {
  name: string;
  materialRoot: string;
  primaryTopics: string[];
  enabledPlatforms: Platform[];
  setupCompleted: boolean;
}

export interface FeishuLibraryTemplate {
  name: string;
  topicStorage: 'ONE_TABLE' | 'BY_CATEGORY';
  includeSchedule: boolean;
  includeReview: boolean;
  status: 'DRAFT' | 'READY_TO_CREATE' | 'CREATED';
}

export const seedState: LocalState = {
  workspace: {
    name: '我的内容工作室',
    materialRoot: '',
    primaryTopics: ['AI 工具实战'],
    enabledPlatforms: ['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'],
    setupCompleted: false,
  },
  feishuTemplate: {
    name: '内容引擎内容库',
    topicStorage: 'ONE_TABLE',
    includeSchedule: true,
    includeReview: false,
    status: 'DRAFT',
  },
  sources: [],
  intelligence: [
    { id: 'intel-sora', title: 'OpenAI 发布 Sora 新功能，视频生成一致性提升', summary: '新版本重点改善长镜头角色一致性和文本指令控制，适合延展为知识视频工具教程。', category: 'AI', source: 'TechCrunch', publishedAt: '10:42', heat: 98, trust: '可信' },
    { id: 'intel-price', title: '国内大模型价格调整，对个体创作者意味着什么', summary: '多个模型服务更新推理套餐，适合从内容生产成本下降的角度切入。', category: '财经', source: '36Kr', publishedAt: '09:15', heat: 85, trust: '待核验' },
    { id: 'intel-history', title: '新发现汉墓材料揭示丝路贸易路线细节', summary: '可做“历史并不遥远”的系列选题，关联现代消费与文化交流。', category: '历史', source: '国家文物局', publishedAt: '昨天', heat: 72, trust: '可信' },
  ],
  topics: [
    { id: 'topic-ai-video', title: '普通人如何用 AI 做知识视频', category: 'AI 工具实战', platforms: ['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'], urgency: '高', status: 'PENDING', plannedDate: '7 月 23 日', coreViewpoint: '通过结构化工作流，普通人也能稳定产出知识视频。', sourceIds: ['intel-sora'] },
    { id: 'topic-price', title: '最新大模型价格调整对个体创作者的影响', category: '财经政策解读', platforms: ['WECHAT'], urgency: '中', status: 'ACCEPTED', plannedDate: '7 月 25 日', coreViewpoint: '成本下降不等于内容质量自动提升。', sourceIds: ['intel-price'] },
  ],
  projects: [
    { id: 'project-ai-video', title: '普通人如何用 AI 做知识视频', status: 'VISUAL', coreViewpoint: '无需深厚专业背景，也能完成结构清晰的知识视频。', factChecks: ['确认视频工具订阅价格', '核实剪映功能限制'], updatedAt: '刚刚', versions: [
      { id: 'version-wechat', platform: 'WECHAT', status: 'PREFLIGHT_PASSED', title: '普通人如何用 AI 做知识视频', body: '本文将把知识视频制作拆解为选题、脚本、视觉和发布四步。', updatedAt: '10:20' },
      { id: 'version-xhs', platform: 'XIAOHONGSHU', status: 'DRAFT', title: '普通人做知识视频的 6 个步骤', body: '第 1 页：先找到值得讲的真实问题。', updatedAt: '10:35' },
      { id: 'version-video', platform: 'VIDEO_CHANNEL', status: 'DRAFT', title: '60 秒口播：AI 做知识视频', body: '在信息爆炸的时代，你是否还在为寻找高质量内容素材而烦恼？', updatedAt: '09:48' },
    ] },
    { id: 'project-weekly', title: 'AIGC 行业周报（第 32 期）', status: 'WRITING', coreViewpoint: '本周值得创作者关注的模型、工具和政策变化。', factChecks: [], updatedAt: '2 小时前', versions: [] },
  ],
};

export async function loadState(): Promise<LocalState> {
  if (window.contentEngine?.state) {
    const result = await window.contentEngine.state.load();
    if (result?.state) return normalizeState(result.state);
  }

  if (window.localStorage.getItem('content-engine-web-session-v1')) {
    const result = await webState.load();
    return normalizeState(result.state);
  }

  // 仅用于从早期原型迁移。正式桌面端不会继续把 localStorage 作为数据层。
  const value = window.localStorage.getItem(key);
  if (!value) return seedState;
  try { return normalizeState(JSON.parse(value) as LocalState); } catch { return seedState; }
}

export async function persistState(state: LocalState): Promise<void> {
  if (window.contentEngine?.state) {
    await window.contentEngine.state.save(state);
    window.localStorage.removeItem(key);
    return;
  }
  if (window.localStorage.getItem('content-engine-web-session-v1')) {
    await webState.save(state);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(state));
}

function normalizeState(state: LocalState): LocalState {
  const intelligence = dedupeIntelligence((state.intelligence ?? []).map((item) => ({ ...item, title: normalizeText(item.title), summary: normalizeText(item.summary) })));
  return {
    ...state,
    workspace: {
      ...seedState.workspace,
      ...state.workspace,
      primaryTopics: state.workspace?.primaryTopics ?? seedState.workspace.primaryTopics,
      enabledPlatforms: state.workspace?.enabledPlatforms ?? seedState.workspace.enabledPlatforms,
      setupCompleted: state.workspace?.setupCompleted ?? false,
    },
    feishuTemplate: { ...seedState.feishuTemplate, ...state.feishuTemplate },
    sources: state.sources ?? [],
    intelligence,
  };
}

export function intelligenceKey(item: Pick<IntelligenceItem, 'title' | 'source'>) {
  return `${item.source.trim().toLocaleLowerCase()}::${normalizeText(item.title).toLocaleLowerCase()}`;
}

function dedupeIntelligence(items: IntelligenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = intelligenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);?/gi, (_match, entity) => {
    const raw = String(entity);
    const code = raw.toLowerCase().startsWith('x') ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
  }).replace(/&(amp|quot|apos|lt|gt);/gi, (_match, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[String(entity).toLowerCase()] ?? _match).replace(/\s+/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/'\s+/g, "'").trim();
}
