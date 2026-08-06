import type { LocalState } from './localRepository';
import type { ApiUsageLog, ApiUsageSummary, ModelCatalogItem, ModelConnection, ModelConnectionInput, ModelTaskPolicy } from '../domain/integrations';
import type { ContentProject, CreativeDelivery, CreativeVisualPlanItem, IntelligenceAnalysis, Platform, ProjectOriginType, ProjectPlanning } from '../domain/content';
import type { AccountVoiceCalibrationDraft, AccountVoiceInput, AccountVoiceProfile, CreativeDraftCandidate, CreativeDraftPreparation, CreativeDraftRun, CreativeOutlineCandidate, CreativeOutlinePreparation, CreativeOutlineRun, CreativePlatform, CreativeSkillDefinition, ProjectAgentContext, ProjectAgentHistory, ProjectAgentPrepareInput, ProjectAgentPrepareResult, ProjectAgentRun, ProjectArtifact, ProjectInput, ProjectInputPayload, ProjectReference, ProjectReferenceMetadata, ProjectResearchContext, ProjectResearchRun, WritingBrief, WritingBriefInput } from '../domain/creative';
import type { ChannelAccount, MetricSnapshot, PlatformDraftTask, PublishPackage, PublishedArticle, PublishReadyDraft, Retrospective } from '../domain/publishing';
import type { WebSession, WorkspaceSession, WorkspaceSummary } from '../domain/workspace';
import type { AssetFilters, AssetMetadataInput, AssetUpdateInput, ProjectAsset, ProjectAssetLinkInput, WorkspaceAsset } from '../domain/assets';
import type { ContentDraft, ContentDraftVersion, DraftAdaptationRun, DraftPatchInput, DraftPreview, DraftPlatform, WechatLayoutDesignResult, WechatLayoutPreview, WechatLayoutRules, WechatLayoutTemplate } from '../domain/content-drafts';
import { sessionStore } from './sessionStore';

const apiBase = import.meta.env.VITE_API_BASE ?? '/api/v1';

export type { WebSession } from '../domain/workspace';

type RequestOptions = RequestInit & { authenticated?: boolean; workspaceScoped?: boolean };

export class WebApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'WebApiError';
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { authenticated = true, workspaceScoped = true, ...fetchOptions } = options;
  const session = sessionStore.read();
  if (authenticated && !session) throw new Error('登录状态已失效，请重新登录。');
  if (authenticated && workspaceScoped && !session?.activeWorkspaceId) throw new Error('请选择工作空间后再继续。');
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const response = await fetch(`${apiBase}${path}`, {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated && session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...(authenticated && workspaceScoped && session?.activeWorkspaceId ? { 'X-Workspace-Id': session.activeWorkspaceId } : {}),
      ...(fetchOptions.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WebApiError(payload?.error?.message || `请求失败（HTTP ${response.status}）。`, response.status, payload?.error?.code, payload?.error?.details);
  return payload as T;
}

async function requestWorkspaceContent(path: string, fallback: string) {
  const session = sessionStore.read();
  if (!session?.activeWorkspaceId) throw new Error('请选择工作空间后再继续。');
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Workspace-Id': session.activeWorkspaceId } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `${fallback}（HTTP ${response.status}）。`);
  }
  return response;
}

function isRetryableSearchError(error: unknown) {
  return error instanceof WebApiError && [502, 503, 504].includes(error.status);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const webAuth = {
  session: sessionStore.read,
  clear: sessionStore.clear,
  async register(input: { email: string; password: string; displayName: string; workspaceName: string }) {
    const result = await request<WebSession>('/auth/register', { method: 'POST', body: JSON.stringify(input), authenticated: false, workspaceScoped: false });
    return sessionStore.write(result);
  },
  async login(input: { email: string; password: string }) {
    const result = await request<WebSession>('/auth/login', { method: 'POST', body: JSON.stringify(input), authenticated: false, workspaceScoped: false });
    return sessionStore.write(result);
  },
  async me() {
    const result = await request<WebSession>('/auth/me', { workspaceScoped: false });
    return sessionStore.write(result);
  },
};

function updateWorkspaceSession(result: WorkspaceSession) {
  const session = sessionStore.read();
  if (!session) throw new Error('登录状态已失效，请重新登录。');
  return sessionStore.write({ ...session, ...result });
}

export const webWorkspaces = {
  async list() {
    return updateWorkspaceSession(await request<WorkspaceSession>('/workspaces', { workspaceScoped: false }));
  },
  async create(name: string) {
    return updateWorkspaceSession(await request<WorkspaceSession>('/workspaces', { method: 'POST', body: JSON.stringify({ name }), workspaceScoped: false }));
  },
  async rename(workspaceId: string, name: string) {
    return updateWorkspaceSession(await request<WorkspaceSession>(`/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: JSON.stringify({ name }), workspaceScoped: false }));
  },
  async select(workspaceId: string) {
    return updateWorkspaceSession(await request<WorkspaceSession>('/me/active-workspace', { method: 'PUT', body: JSON.stringify({ workspaceId }), workspaceScoped: false }));
  },
  deletionImpact(workspaceId: string) {
    return request<{ projects: number; assets: number; channelAccounts: number; publications: number; metricSnapshots: number; retrospectives: number }>(`/workspaces/${encodeURIComponent(workspaceId)}/deletion-impact`, { workspaceScoped: false });
  },
  async remove(workspaceId: string, confirmationName: string) {
    return updateWorkspaceSession(await request<WorkspaceSession & { deletionJobId: string; queueJobId: string; queued: boolean }>(`/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE', body: JSON.stringify({ confirmationName }), workspaceScoped: false }));
  },
  current: (): WorkspaceSummary | null => {
    const session = sessionStore.read();
    return session?.workspaces.find(({ id }) => id === session.activeWorkspaceId) ?? null;
  },
};

export const webAssets = {
  list(filters: AssetFilters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.origin) params.set('origin', filters.origin);
    if (filters.query?.trim()) params.set('query', filters.query.trim());
    const suffix = params.size ? `?${params}` : '';
    return request<{ assets: WorkspaceAsset[] }>(`/assets${suffix}`);
  },
  upload(file: File, input: Partial<AssetMetadataInput> = {}) {
    const params = new URLSearchParams();
    if (input.title?.trim()) params.set('title', input.title.trim());
    if (input.sourceNote !== undefined) params.set('sourceNote', input.sourceNote);
    if (input.copyrightStatus) params.set('copyrightStatus', input.copyrightStatus);
    const body = new FormData();
    body.append('file', file);
    const suffix = params.size ? `?${params}` : '';
    return request<{ created: boolean; asset: WorkspaceAsset }>(`/assets${suffix}`, { method: 'POST', body });
  },
  import(input: AssetMetadataInput & { url: string }) {
    return request<{ created: boolean; asset: WorkspaceAsset }>('/assets/import', { method: 'POST', body: JSON.stringify(input) });
  },
  get: (assetId: string) => request<WorkspaceAsset>(`/assets/${encodeURIComponent(assetId)}`),
  async content(assetId: string) {
    return (await requestWorkspaceContent(`/assets/${encodeURIComponent(assetId)}/content`, '读取素材失败')).blob();
  },
  update: (assetId: string, input: AssetUpdateInput) => request<WorkspaceAsset>(`/assets/${encodeURIComponent(assetId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (assetId: string) => request<{ assetId: string; deletionJobId: string; queueJobId: string; queued: boolean }>(`/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  link: (projectId: string, assetId: string, input: ProjectAssetLinkInput) => request<ProjectAsset>(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, { method: 'POST', body: JSON.stringify(input) }),
  unlink: (projectId: string, assetId: string) => request<void>(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
};

export const webDrafts = {
  list: (projectId: string) => request<{ drafts: ContentDraft[] }>(`/creative/projects/${encodeURIComponent(projectId)}/drafts`),
  upsertWechat: (projectId: string, input: { title: string; body: string }) => request<ContentDraft>(`/creative/projects/${encodeURIComponent(projectId)}/wechat-draft`, { method: 'POST', body: JSON.stringify(input) }),
  patch: (draftId: string, input: DraftPatchInput) => request<ContentDraft>(`/content-drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  replaceAssets: (draftId: string, input: { revision: number; assets: Array<{ assetId: string; role: 'COVER' | 'BODY' | 'CARD' | 'MAIN' }> }) => request<ContentDraft>(`/content-drafts/${encodeURIComponent(draftId)}/assets`, { method: 'PUT', body: JSON.stringify(input) }),
  complete: (draftId: string, revision: number) => request<{ draft: ContentDraft; version: ContentDraftVersion }>(`/content-drafts/${encodeURIComponent(draftId)}/complete`, { method: 'POST', body: JSON.stringify({ revision }) }),
  derive: (draftId: string, platform: Exclude<DraftPlatform, 'WECHAT'>) => request<DraftAdaptationRun>(`/content-drafts/${encodeURIComponent(draftId)}/derive`, { method: 'POST', body: JSON.stringify({ platform }) }),
  adaptation: (runId: string) => request<DraftAdaptationRun>(`/content-draft-adaptation-runs/${encodeURIComponent(runId)}`),
  confirmAdaptation: (runId: string) => request<DraftAdaptationRun>(`/content-draft-adaptation-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelAdaptation: (runId: string) => request<DraftAdaptationRun>(`/content-draft-adaptation-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  versions: (draftId: string) => request<{ versions: ContentDraftVersion[] }>(`/content-drafts/${encodeURIComponent(draftId)}/versions`),
  preview: (draftId: string) => request<DraftPreview>(`/content-drafts/${encodeURIComponent(draftId)}/preview`),
  designLayout: (draftId: string, input: { templateId?: string; templateVersionId?: string; instruction?: string }) => request<WechatLayoutDesignResult>(`/creative/drafts/${encodeURIComponent(draftId)}/layout/design`, { method: 'POST', body: JSON.stringify(input) }),
};

export const webChannelAccounts = {
  list: () => request<{ accounts: ChannelAccount[] }>('/channel-accounts'),
  create: (input: { platform: 'WECHAT' | 'XIAOHONGSHU' | 'WEIBO'; name: string; externalAccountLabel?: string; mode?: 'MANUAL' | 'OFFICIAL' }) => request<{ account: ChannelAccount }>('/channel-accounts', { method: 'POST', body: JSON.stringify(input) }),
  saveOfficialCredential: (accountId: string, input: { appId: string; appSecret: string }) => request<{ account: ChannelAccount }>(`/channel-accounts/${encodeURIComponent(accountId)}/official-credential`, { method: 'PUT', body: JSON.stringify(input) }),
  testOfficialCredential: (accountId: string) => request<{ account: ChannelAccount }>(`/channel-accounts/${encodeURIComponent(accountId)}/official-credential/test`, { method: 'POST', body: '{}' }),
  remove: (accountId: string) => request<{ account: ChannelAccount }>(`/channel-accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
};

export const webPublishing = {
  readyDrafts: () => request<{ drafts: PublishReadyDraft[] }>('/publishing/ready-drafts'),
  packages: (input: { accountId: string; draftVersionId: string }) => request<{ task: PlatformDraftTask; package: PublishPackage }>('/publishing/packages', { method: 'POST', body: JSON.stringify(input) }),
  createOfficialDraft: (input: { accountId: string; draftVersionId: string }) => request<{ task: PlatformDraftTask; package: PublishPackage }>('/publishing/official-drafts', { method: 'POST', body: JSON.stringify(input) }),
  tasks: () => request<{ tasks: PlatformDraftTask[] }>('/publishing/tasks'),
  manualConfirm: (taskId: string, input: { url?: string; note?: string; publishedAt?: string }) => request<{ task: PlatformDraftTask; publication: PublishedArticle }>(`/publishing/tasks/${encodeURIComponent(taskId)}/manual-confirm`, { method: 'POST', body: JSON.stringify(input) }),
  articles: () => request<{ articles: PublishedArticle[] }>('/publishing/articles'),
  addMetrics: (articleId: string, input: { capturedAt?: string; readCount?: number; likeCount?: number; shareCount?: number; favoriteCount?: number; commentCount?: number; followerDelta?: number }) => request<{ metric: MetricSnapshot }>(`/publishing/articles/${encodeURIComponent(articleId)}/metrics`, { method: 'POST', body: JSON.stringify(input) }),
  metrics: (articleId: string) => request<{ metrics: MetricSnapshot[] }>(`/publishing/articles/${encodeURIComponent(articleId)}/metrics`),
  saveRetrospective: (articleId: string, input: { summary?: string; highlights?: string[]; issues?: string[]; nextActions?: string[] }) => request<{ retrospective: Retrospective }>(`/publishing/articles/${encodeURIComponent(articleId)}/retrospective`, { method: 'PUT', body: JSON.stringify(input) }),
};

export const webWechatTemplates = {
  list: () => request<{ templates: WechatLayoutTemplate[] }>('/wechat-layout-templates'),
  create: (input: { name: string; rules: WechatLayoutRules }) => request<WechatLayoutTemplate>('/wechat-layout-templates', { method: 'POST', body: JSON.stringify(input) }),
  patch: (templateId: string, input: { name: string; rules: WechatLayoutRules }) => request<WechatLayoutTemplate>(`/wechat-layout-templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  duplicate: (templateId: string, name: string) => request<WechatLayoutTemplate>(`/wechat-layout-templates/${encodeURIComponent(templateId)}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  archive: (templateId: string) => request<void>(`/wechat-layout-templates/${encodeURIComponent(templateId)}/archive`, { method: 'POST', body: '{}' }),
  remove: (templateId: string) => request<void>(`/wechat-layout-templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' }),
  import: (input: { name: string; url: string }) => request<WechatLayoutTemplate>('/wechat-layout-templates/import', { method: 'POST', body: JSON.stringify({ ...input, confirmedRights: true }) }),
  preview: (templateId: string, draftId: string) => request<WechatLayoutPreview>(`/wechat-layout-templates/${encodeURIComponent(templateId)}/preview`, { method: 'POST', body: JSON.stringify({ draftId }) }),
};

export const webState = {
  async load() { return request<{ state: LocalState; revision: number; updatedAt: string }>('/workspace/state'); },
  async savePreferences(input: { workspace?: LocalState['workspace']; feishuTemplate?: LocalState['feishuTemplate'] }) {
    return request<{ revision: number; updatedAt: string }>('/workspace/preferences', { method: 'PATCH', body: JSON.stringify(input) });
  },
};

export const webAccountVoices = {
  list: () => request<{ voices: AccountVoiceProfile[] }>('/account-voices'),
  create: (input: AccountVoiceInput) => request<{ voice: AccountVoiceProfile }>('/account-voices', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: AccountVoiceInput) => request<{ voice: AccountVoiceProfile }>(`/account-voices/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  makeDefault: (id: string) => request<{ voice: AccountVoiceProfile }>(`/account-voices/${encodeURIComponent(id)}/default`, { method: 'POST', body: '{}' }),
  addCalibration: (id: string, input: { sourceType: 'LINK' | 'FILE' | 'TEXT'; title: string; sourceUrl?: string; fileReference?: string; ruleSummary: string; confirmedLicensed: boolean }) => request<{ calibration: { id: string; title: string; rule_summary: string; created_at: string } }>(`/account-voices/${encodeURIComponent(id)}/calibrations`, { method: 'POST', body: JSON.stringify(input) }),
  createCalibrationDraft: (input: { sourceUrl: string; confirmedLicensed: boolean }) => request<{ article: { title: string; url: string; source: string }; draft: AccountVoiceCalibrationDraft }>('/account-voices/calibration-drafts', { method: 'POST', body: JSON.stringify(input) }),
};

export type CreateProjectInput = {
  originType: Extract<ProjectOriginType, 'MANUAL' | 'DRAFT' | 'IMPORT'>;
  title?: string;
  category?: string;
  draftText?: string;
  importUrl?: string;
  targetPlatforms?: Platform[];
};

export const webProjects = {
  list: () => request<{ projects: ContentProject[] }>('/creative/projects'),
  create: (input: CreateProjectInput) => request<{ project: ContentProject; created: boolean }>('/creative/projects', { method: 'POST', body: JSON.stringify(input) }),
  fromIntelligence: (itemId: string, input: { angleIndex?: number } = {}) => request<{ project: ContentProject; created: boolean }>(`/creative/projects/from-intelligence/${encodeURIComponent(itemId)}`, { method: 'POST', body: JSON.stringify(input) }),
  planning: (projectId: string) => request<{ project: ContentProject; planning: ProjectPlanning }>(`/creative/projects/${encodeURIComponent(projectId)}/planning`),
  savePlanning: (projectId: string, planning: ProjectPlanning) => request<{ project: ContentProject; planning: ProjectPlanning }>(`/creative/projects/${encodeURIComponent(projectId)}/planning`, { method: 'PUT', body: JSON.stringify(planning) }),
  completePlanning: (projectId: string) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/planning/complete`, { method: 'POST', body: '{}' }),
};

export const webCreative = {
  skills: () => request<CreativeSkillDefinition[]>('/creative/skills'),
  updateVersion: (projectId: string, versionId: string, input: { title: string; body: string }) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`, { method: 'PUT', body: JSON.stringify(input) }),
  brief: (projectId: string) => request<{ brief: WritingBrief | null }>(`/creative/projects/${encodeURIComponent(projectId)}/brief`),
  saveBrief: (projectId: string, input: WritingBriefInput) => request<{ brief: WritingBrief }>(`/creative/projects/${encodeURIComponent(projectId)}/brief`, { method: 'PUT', body: JSON.stringify(input) }),
  materials: (projectId: string) => request<{ inputs: ProjectInput[]; references: ProjectReference[]; assets: ProjectAsset[] }>(`/creative/projects/${encodeURIComponent(projectId)}/materials`),
  createInput: (projectId: string, input: ProjectInputPayload) => request<ProjectInput>(`/creative/projects/${encodeURIComponent(projectId)}/inputs`, { method: 'POST', body: JSON.stringify(input) }),
  updateInput: (id: string, input: ProjectInputPayload) => request<ProjectInput>(`/creative/project-inputs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeInput: (id: string) => request<void>(`/creative/project-inputs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createReference: (projectId: string, input: ProjectReferenceMetadata & { url: string }) => request<ProjectReference>(`/creative/projects/${encodeURIComponent(projectId)}/references`, { method: 'POST', body: JSON.stringify(input) }),
  async searchImages(query: string) {
    const delays = [0, 120, 240];
    let lastError: unknown;
    for (const [attemptIndex, delayMs] of delays.entries()) {
      if (delayMs) await wait(delayMs);
      try {
        return await request<{ provider: string; results: Array<{ id: string; title: string; thumbnailUrl: string; imageUrl: string; sourceUrl: string; license: string; attribution: string; copyrightStatus: 'PENDING' | 'OPEN_LICENSE' }> }>(`/creative/image-search?q=${encodeURIComponent(query)}`);
      } catch (error) {
        lastError = error;
        if (!isRetryableSearchError(error) || attemptIndex === delays.length - 1) break;
      }
    }
    if (isRetryableSearchError(lastError)) {
      const fallback = lastError as WebApiError;
      throw new WebApiError('图片搜索服务暂时不可用，请稍后重试。', fallback.status, fallback.code, fallback.details);
    }
    throw lastError instanceof Error ? lastError : new Error('图片搜索失败。');
  },
  planVisual: (projectId: string, input: { platform: 'WECHAT'; quantityMode: 'AUTO' | 'MANUAL'; bodyItemCount?: number; styleProfile: import('../domain/content').CreativeVisualStyleProfile; request?: string; currentItemId?: string; currentPlan?: CreativeVisualPlanItem[]; keepAssignedAssets?: boolean }) => request<{ plan: CreativeVisualPlanItem[]; bodyItemCount: number; quantityMode: 'AUTO' | 'MANUAL'; strategy: string; policy: { scope: string; provider: string; connectionId: string | null; model: string; promptVersion: string } }>(`/creative/projects/${encodeURIComponent(projectId)}/visual/plan`, { method: 'POST', body: JSON.stringify(input) }),
  generateImage: (projectId: string, input: { platform: 'WECHAT'; visualItemId: string; assetIds?: string[] } | { platform: Exclude<DraftPlatform, 'WECHAT'>; prompt: string; size: '3:4' | '1:1'; assetIds?: string[] }) => request<{ asset: WorkspaceAsset; projectAsset: ProjectAsset; policy: { scope: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE'; provider: string; model: string } }>(`/creative/projects/${encodeURIComponent(projectId)}/visual/generate`, { method: 'POST', body: JSON.stringify(input) }),
  updateReference: (id: string, input: ProjectReferenceMetadata) => request<ProjectReference>(`/creative/project-references/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeReference: (id: string) => request<void>(`/creative/project-references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  research: (projectId: string) => request<ProjectResearchContext>(`/creative/projects/${encodeURIComponent(projectId)}/research`),
  startResearch: (projectId: string, input: { request?: string } = {}) => request<ProjectAgentRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/start`, { method: 'POST', body: JSON.stringify(input) }),
  acceptResearchResult: (artifactId: string) => request<{ artifact: ProjectArtifact; project: ContentProject }>(`/creative/research-results/${encodeURIComponent(artifactId)}/accept`, { method: 'POST', body: '{}' }),
  skipResearch: (projectId: string) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/research/skip`, { method: 'POST', body: '{}' }),
  prepareResearch: (projectId: string, input: { request: string; inputIds: string[]; referenceIds: string[]; assetIds: string[] }) => request<ProjectResearchRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/prepare`, { method: 'POST', body: JSON.stringify(input) }),
  confirmResearch: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/research-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelResearch: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/creative/research-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  agentContext: (projectId: string, input: { stage: ProjectAgentContext['stage']; platform?: CreativePlatform; history: ProjectAgentHistory }) => {
    const params = new URLSearchParams({ stage: input.stage, history: input.history });
    if (input.platform) params.set('platform', input.platform);
    return request<ProjectAgentContext>(`/creative/projects/${encodeURIComponent(projectId)}/agent?${params}`);
  },
  prepareAgent: (projectId: string, input: ProjectAgentPrepareInput) => request<ProjectAgentPrepareResult>(`/creative/projects/${encodeURIComponent(projectId)}/agent/prepare`, { method: 'POST', body: JSON.stringify(input) }),
  agentRun: (runId: string) => request<ProjectAgentRun>(`/creative/agent-runs/${encodeURIComponent(runId)}`),
  confirmAgentRun: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/agent-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelAgentRun: (runId: string) => request<ProjectAgentRun>(`/creative/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  prepareResearchSources: (projectId: string, planArtifactId: string) => request<ProjectAgentRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/sources/prepare`, { method: 'POST', body: JSON.stringify({ planArtifactId }) }),
  confirmResearchSources: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/research-source-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelResearchSources: (runId: string) => request<ProjectAgentRun>(`/creative/research-source-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  prepareSourceVerification: (projectId: string, sourceArtifactId: string, selectedSourceIds: string[]) => request<ProjectAgentRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/verification/prepare`, { method: 'POST', body: JSON.stringify({ sourceArtifactId, selectedSourceIds }) }),
  confirmSourceVerification: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/source-verification-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelSourceVerification: (runId: string) => request<ProjectAgentRun>(`/creative/source-verification-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  acceptSourceVerification: (artifactId: string) => request<{ artifact: ProjectArtifact }>(`/creative/research-verifications/${encodeURIComponent(artifactId)}/accept`, { method: 'POST', body: '{}' }),
  acceptArtifact: (artifactId: string, selectedTitle?: string) => request<{ artifact: ProjectArtifact; project: ContentProject }>(`/creative/project-artifacts/${encodeURIComponent(artifactId)}/accept`, { method: 'POST', body: JSON.stringify(selectedTitle ? { selectedTitle } : {}) }),
  rejectArtifact: (artifactId: string) => request<{ id: string; status: 'REJECTED' }>(`/creative/project-artifacts/${encodeURIComponent(artifactId)}/reject`, { method: 'POST', body: '{}' }),
  enableProjectPlatform: (projectId: string, platform: CreativePlatform) => request<{ project: ContentProject; platform: CreativePlatform; created: boolean }>(`/creative/projects/${encodeURIComponent(projectId)}/platforms/${encodeURIComponent(platform)}`, { method: 'POST', body: '{}' }),
  completePlatformVersions: (projectId: string, platform: CreativePlatform) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/platform-versions/complete`, { method: 'POST', body: JSON.stringify({ platform }) }),
  delivery: (projectId: string) => request<{ delivery: CreativeDelivery }>(`/creative/projects/${encodeURIComponent(projectId)}/delivery`),
  saveVisual: (projectId: string, input: { platform: CreativePlatform; planVersion: number; styleProfile: import('../domain/content').CreativeVisualStyleProfile; coverAssetId: string | null; assetIds: string[]; plan: CreativeVisualPlanItem[] }) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/visual`, { method: 'PUT', body: JSON.stringify(input) }),
  completeVisual: (projectId: string, platform: CreativePlatform) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/visual/complete`, { method: 'POST', body: JSON.stringify({ platform }) }),
  generateLayout: (projectId: string, platform: CreativePlatform) => request<{ project: ContentProject; delivery: CreativeDelivery }>(`/creative/projects/${encodeURIComponent(projectId)}/layout/generate`, { method: 'POST', body: JSON.stringify({ platform }) }),
  completeLayout: (projectId: string, platform: CreativePlatform) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/layout/complete`, { method: 'POST', body: JSON.stringify({ platform }) }),
  completeReview: (projectId: string, platform: CreativePlatform, acknowledgedFactChecks: string[]) => request<{ project: ContentProject; delivery: CreativeDelivery }>(`/creative/projects/${encodeURIComponent(projectId)}/review/complete`, { method: 'POST', body: JSON.stringify({ platform, acknowledgedFactChecks }) }),
  prepareOutline: (projectId: string, platform: CreativePlatform) => request<CreativeOutlinePreparation>(`/creative/projects/${encodeURIComponent(projectId)}/outline/prepare`, { method: 'POST', body: JSON.stringify({ platform }) }),
  confirmOutline: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/outline-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelOutline: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/creative/outline-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  latestOutlineRun: (projectId: string, platform: CreativePlatform) => request<CreativeOutlineRun | null>(`/creative/projects/${encodeURIComponent(projectId)}/outline/latest-run?platform=${encodeURIComponent(platform)}`),
  latestOutline: (projectId: string, platform: CreativePlatform) => request<CreativeOutlineCandidate | null>(`/creative/projects/${encodeURIComponent(projectId)}/outline/latest?platform=${encodeURIComponent(platform)}`),
  acceptOutline: (candidateId: string, selectedTitle: string) => request<{ candidate: CreativeOutlineCandidate; project: ContentProject }>(`/creative/outline-candidates/${encodeURIComponent(candidateId)}/accept`, { method: 'POST', body: JSON.stringify({ selectedTitle }) }),
  prepareDraft: (projectId: string, platform: CreativePlatform) => request<CreativeDraftPreparation>(`/creative/projects/${encodeURIComponent(projectId)}/draft/prepare`, { method: 'POST', body: JSON.stringify({ platform }) }),
  confirmDraft: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/draft-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelDraft: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/creative/draft-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  latestDraftRun: (projectId: string, platform: CreativePlatform) => request<CreativeDraftRun | null>(`/creative/projects/${encodeURIComponent(projectId)}/draft/latest-run?platform=${encodeURIComponent(platform)}`),
  latestDraft: (projectId: string, platform: CreativePlatform) => request<CreativeDraftCandidate | null>(`/creative/projects/${encodeURIComponent(projectId)}/draft/latest?platform=${encodeURIComponent(platform)}`),
  acceptDraft: (candidateId: string) => request<{ candidate: CreativeDraftCandidate; project: ContentProject }>(`/creative/draft-candidates/${encodeURIComponent(candidateId)}/accept`, { method: 'POST', body: '{}' }),
  job: (jobId: string) => request<{ id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string }>(`/jobs/${encodeURIComponent(jobId)}`),
};

export const webIntelligence = {
  listSources: () => request<LocalState['sources']>('/intelligence/sources'),
  createSources: (sources: Omit<LocalState['sources'][number], 'id' | 'lastSyncedAt' | 'lastError'>[]) => request<LocalState['sources']>('/intelligence/sources', { method: 'POST', body: JSON.stringify({ sources }) }),
  updateSource: (sourceId: string, source: Omit<LocalState['sources'][number], 'id' | 'lastSyncedAt' | 'lastError'>) => request<LocalState['sources'][number]>(`/intelligence/sources/${sourceId}`, { method: 'PUT', body: JSON.stringify(source) }),
  removeSource: (sourceId: string) => request<void>(`/intelligence/sources/${sourceId}`, { method: 'DELETE' }),
  listItems: () => request<LocalState['intelligence']>('/intelligence/items'),
  saveItem: (item: Omit<LocalState['intelligence'][number], 'id' | 'analysis'>) => request<LocalState['intelligence'][number]>('/intelligence/items', { method: 'POST', body: JSON.stringify(item) }),
  refreshRss: () => request<{ items: LocalState['intelligence']; results: { sourceId: string; ok: boolean; count: number; error?: string }[]; sources: LocalState['sources'] }>('/intelligence/rss/refresh', { method: 'POST', body: '{}' }),
  previewLink: (url: string) => request<{ url: string; title: string; summary: string; source: string; category: string; keywords: string[] }>('/intelligence/clip', { method: 'POST', body: JSON.stringify({ url }) }),
  webSearchStatus: () => request<CredentialStatus>('/settings/credentials/TAVILY'),
  saveWebSearchKey: (apiKey: string) => request<CredentialStatus>('/settings/credentials/TAVILY', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  searchWeb: (input: { query: string; category: string; domains: string[] }) => request<LocalState['intelligence']>('/intelligence/search', { method: 'POST', body: JSON.stringify(input) }),
  prepareAnalysis: (itemId: string) => request<AnalysisPreparation>(`/intelligence/items/${itemId}/analyses/prepare`, { method: 'POST', body: '{}' }),
  confirmAnalysis: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/generation-runs/${runId}/confirm`, { method: 'POST', body: '{}' }),
  cancelAnalysis: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/generation-runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
  latestAnalysis: (itemId: string) => request<IntelligenceAnalysis | null>(`/intelligence/items/${itemId}/analyses/latest`),
  latestAnalysisRun: (itemId: string) => request<AnalysisRun | null>(`/intelligence/items/${itemId}/analyses/latest-run`),
  job: (jobId: string) => request<{ id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string }>(`/jobs/${jobId}`),
};

export type AnalysisPreparation = { id: string; status: 'DRAFT'; createdAt: string; confirmation: { sourceCount: number; platform: 'WECHAT'; model: string; promptVersion: number; generalAudienceWarning: boolean; costEstimate: number | null } };
export type AnalysisRun = Omit<AnalysisPreparation, 'status'> & { status: 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string; jobId?: string };

export type CredentialStatus = { provider: 'BAILIAN' | 'TAVILY'; configured: boolean; status: 'UNCONFIGURED' | 'UNVERIFIED' | 'READY' | 'ERROR'; updatedAt?: string | null; lastTestedAt?: string | null; lastError?: string | null };
export type PromptTemplateScope =
  | 'INTELLIGENCE_ANALYSIS'
  | 'SOURCE_VERIFICATION'
  | 'WECHAT_COPY_GENERATION';
export type PromptTemplate = { id: string; scope: PromptTemplateScope; version: number; body: string; source: 'DEFAULT' | 'CUSTOM'; updatedAt: string };

export const webAgent = {
  credentialStatus: () => request<CredentialStatus>('/settings/credentials/BAILIAN'),
  saveCredential: (apiKey: string) => request<CredentialStatus>('/settings/credentials/BAILIAN', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  testCredential: () => request<CredentialStatus>('/settings/credentials/BAILIAN/test', { method: 'POST', body: '{}' }),
  removeCredential: () => request<void>('/settings/credentials/BAILIAN', { method: 'DELETE' }),
  policy: () => request<{ scope: string; configured?: boolean; model?: string }>('/agent/model-policies/AGENT_PLANNER'),
  savePolicy: (model: string) => request<{ scope: string; provider: string; model: string }>('/agent/model-policies/AGENT_PLANNER', { method: 'PUT', body: JSON.stringify({ model }) }),
};

export const webSettings = {
  credentials: () => request<CredentialStatus[]>('/settings/credentials'),
  testCredential: (provider: CredentialStatus['provider']) => request<CredentialStatus>(`/settings/credentials/${provider}/test`, { method: 'POST', body: '{}' }),
  removeCredential: (provider: CredentialStatus['provider']) => request<void>(`/settings/credentials/${provider}`, { method: 'DELETE' }),
};

export const webModels = {
  connections: () => request<ModelConnection[]>('/models/connections'),
  createConnection: (input: ModelConnectionInput) => request<ModelConnection>('/models/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: ModelConnectionInput) => request<ModelConnection>(`/models/connections/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  testConnection: (id: string) => request<ModelConnection>(`/models/connections/${id}/test`, { method: 'POST', body: '{}' }),
  removeConnection: (id: string) => request<void>(`/models/connections/${id}`, { method: 'DELETE' }),
  catalog: () => request<ModelCatalogItem[]>('/models/catalog'),
  syncCatalog: () => request<{ items: ModelCatalogItem[]; errors: { connectionLabel: string; message: string }[] }>('/models/catalog/sync', { method: 'POST', body: '{}' }),
  taskPolicies: () => request<ModelTaskPolicy[]>('/models/task-policies'),
  saveTaskPolicy: (policy: ModelTaskPolicy) => request<ModelTaskPolicy>(`/models/task-policies/${policy.task}`, { method: 'PUT', body: JSON.stringify(policy) }),
  usage: () => request<{ summary: ApiUsageSummary; logs: ApiUsageLog[] }>('/models/usage'),
  promptTemplate: (scope: PromptTemplateScope = 'INTELLIGENCE_ANALYSIS') => request<PromptTemplate>(`/settings/prompt-templates/${scope}`),
  savePromptTemplate: (scope: PromptTemplateScope, body: string) => request<PromptTemplate>(`/settings/prompt-templates/${scope}`, { method: 'PUT', body: JSON.stringify({ body }) }),
  resetPromptTemplate: (scope: PromptTemplateScope) => request<PromptTemplate>(`/settings/prompt-templates/${scope}/reset`, { method: 'POST', body: '{}' }),
};
