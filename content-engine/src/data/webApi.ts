import type { LocalState } from './localRepository';
import type { ApiUsageLog, ApiUsageSummary, ModelCatalogItem, ModelConnection, ModelConnectionInput, ModelTaskPolicy } from '../domain/integrations';
import type { ContentProject, IntelligenceAnalysis, Platform, ProjectOriginType, ProjectPlanning } from '../domain/content';
import type { AccountVoiceCalibrationDraft, AccountVoiceInput, AccountVoiceProfile, CreativeDraftCandidate, CreativeDraftPreparation, CreativeDraftRun, CreativeOutlineCandidate, CreativeOutlinePreparation, CreativeOutlineRun, CreativePlatform, CreativeSkillDefinition, ProjectAgentContext, ProjectAgentHistory, ProjectAgentPrepareInput, ProjectAgentPrepareResult, ProjectAgentRun, ProjectArtifact, ProjectInput, ProjectInputPayload, ProjectReference, ProjectReferenceMetadata, ProjectResearchContext, ProjectResearchRun, WritingBrief, WritingBriefInput } from '../domain/creative';

const tokenKey = 'content-engine-web-session-v1';
const apiBase = import.meta.env.VITE_API_BASE ?? '/api/v1';

export type WebSession = { accessToken: string; user: { id: string; email: string; display_name?: string }; workspace: { id: string; name: string } };

function readSession(): WebSession | null {
  try { return JSON.parse(window.localStorage.getItem(tokenKey) ?? 'null') as WebSession | null; } catch { return null; }
}

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const session = readSession();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...(options.body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）。`);
  return payload as T;
}

export const webAuth = {
  session: readSession,
  clear: () => window.localStorage.removeItem(tokenKey),
  async register(input: { email: string; password: string; displayName: string; workspaceName: string }) {
    const result = await request<WebSession>('/auth/register', { method: 'POST', body: JSON.stringify(input) }, false);
    window.localStorage.setItem(tokenKey, JSON.stringify(result)); return result;
  },
  async login(input: { email: string; password: string }) {
    const result = await request<WebSession>('/auth/login', { method: 'POST', body: JSON.stringify(input) }, false);
    window.localStorage.setItem(tokenKey, JSON.stringify(result)); return result;
  },
  async me() { return request<{ user: WebSession['user']; workspace: WebSession['workspace'] }>('/auth/me'); },
};

export const webState = {
  async load() { return request<{ state: LocalState; revision: number; updatedAt: string }>('/workspace/state'); },
  async save(state: LocalState) { return request<{ revision: number; updatedAt: string }>('/workspace/state', { method: 'PUT', body: JSON.stringify({ state }) }); },
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
  brief: (projectId: string) => request<{ brief: WritingBrief | null }>(`/creative/projects/${encodeURIComponent(projectId)}/brief`),
  saveBrief: (projectId: string, input: WritingBriefInput) => request<{ brief: WritingBrief }>(`/creative/projects/${encodeURIComponent(projectId)}/brief`, { method: 'PUT', body: JSON.stringify(input) }),
  materials: (projectId: string) => request<{ inputs: ProjectInput[]; references: ProjectReference[] }>(`/creative/projects/${encodeURIComponent(projectId)}/materials`),
  createInput: (projectId: string, input: ProjectInputPayload) => request<ProjectInput>(`/creative/projects/${encodeURIComponent(projectId)}/inputs`, { method: 'POST', body: JSON.stringify(input) }),
  updateInput: (id: string, input: ProjectInputPayload) => request<ProjectInput>(`/creative/project-inputs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeInput: (id: string) => request<void>(`/creative/project-inputs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createReference: (projectId: string, input: ProjectReferenceMetadata & { url: string }) => request<ProjectReference>(`/creative/projects/${encodeURIComponent(projectId)}/references`, { method: 'POST', body: JSON.stringify(input) }),
  updateReference: (id: string, input: ProjectReferenceMetadata) => request<ProjectReference>(`/creative/project-references/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeReference: (id: string) => request<void>(`/creative/project-references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadFile: (projectId: string, file: File, input: ProjectReferenceMetadata) => {
    const params = new URLSearchParams({ title: input.title, role: input.role, scope: input.scope, notes: input.notes, platforms: input.platforms.join(',') });
    const body = new FormData(); body.append('file', file);
    return request<ProjectReference>(`/creative/projects/${encodeURIComponent(projectId)}/files?${params}`, { method: 'POST', body });
  },
  async projectFile(id: string) {
    const session = readSession();
    const response = await fetch(`${apiBase}/creative/project-files/${encodeURIComponent(id)}/content`, { headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {} });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload?.error?.message || `读取文件失败（HTTP ${response.status}）。`); }
    return response.blob();
  },
  research: (projectId: string) => request<ProjectResearchContext>(`/creative/projects/${encodeURIComponent(projectId)}/research`),
  startResearch: (projectId: string, input: { request?: string } = {}) => request<ProjectAgentRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/start`, { method: 'POST', body: JSON.stringify(input) }),
  acceptResearchResult: (artifactId: string) => request<{ artifact: ProjectArtifact; project: ContentProject }>(`/creative/research-results/${encodeURIComponent(artifactId)}/accept`, { method: 'POST', body: '{}' }),
  skipResearch: (projectId: string) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/research/skip`, { method: 'POST', body: '{}' }),
  prepareResearch: (projectId: string, input: { request: string; inputIds: string[]; referenceIds: string[] }) => request<ProjectResearchRun>(`/creative/projects/${encodeURIComponent(projectId)}/research/prepare`, { method: 'POST', body: JSON.stringify(input) }),
  confirmResearch: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/creative/research-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST', body: '{}' }),
  cancelResearch: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/creative/research-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
  agentContext: (projectId: string, input: { stage: ProjectAgentContext['stage']; platform?: CreativePlatform; history: ProjectAgentHistory }) => {
    const params = new URLSearchParams({ stage: input.stage, history: input.history });
    if (input.platform) params.set('platform', input.platform);
    return request<ProjectAgentContext>(`/creative/projects/${encodeURIComponent(projectId)}/agent?${params}`);
  },
  prepareAgent: (projectId: string, input: ProjectAgentPrepareInput) => request<ProjectAgentPrepareResult>(`/creative/projects/${encodeURIComponent(projectId)}/agent/prepare`, { method: 'POST', body: JSON.stringify(input) }),
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
  completePlatformVersions: (projectId: string) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/platform-versions/complete`, { method: 'POST', body: '{}' }),
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
  refreshRss: () => request<{ items: LocalState['intelligence']; results: { sourceId: string; ok: boolean; count: number; error?: string }[]; sources: LocalState['sources'] }>('/intelligence/rss/refresh', { method: 'POST', body: '{}' }),
  previewLink: (url: string) => request<{ url: string; title: string; summary: string; source: string; category: string; keywords: string[] }>('/intelligence/clip', { method: 'POST', body: JSON.stringify({ url }) }),
  webSearchStatus: () => request<CredentialStatus>('/settings/credentials/TAVILY'),
  saveWebSearchKey: (apiKey: string) => request<CredentialStatus>('/settings/credentials/TAVILY', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  searchWeb: (input: { query: string; category: string; domains: string[] }) => request<LocalState['intelligence']>('/intelligence/search', { method: 'POST', body: JSON.stringify(input) }),
  prepareAnalysis: (itemId: string, platforms: Platform[]) => request<AnalysisPreparation>(`/intelligence/items/${itemId}/analyses/prepare`, { method: 'POST', body: JSON.stringify({ platforms }) }),
  confirmAnalysis: (runId: string) => request<{ id: string; status: 'QUEUED'; jobId: string }>(`/generation-runs/${runId}/confirm`, { method: 'POST', body: '{}' }),
  cancelAnalysis: (runId: string) => request<{ id: string; status: 'CANCELLED' }>(`/generation-runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
  latestAnalysis: (itemId: string) => request<IntelligenceAnalysis | null>(`/intelligence/items/${itemId}/analyses/latest`),
  latestAnalysisRun: (itemId: string) => request<AnalysisRun | null>(`/intelligence/items/${itemId}/analyses/latest-run`),
  job: (jobId: string) => request<{ id: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string }>(`/jobs/${jobId}`),
};

export type AnalysisPreparation = { id: string; status: 'DRAFT'; createdAt: string; confirmation: { sourceCount: number; platforms: Platform[]; model: string; promptVersion: number; generalAudienceWarning: boolean; costEstimate: number | null } };
export type AnalysisRun = Omit<AnalysisPreparation, 'status'> & { status: 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string; jobId?: string };

export type CredentialStatus = { provider: 'BAILIAN' | 'TAVILY'; configured: boolean; status: 'UNCONFIGURED' | 'UNVERIFIED' | 'READY' | 'ERROR'; updatedAt?: string | null; lastTestedAt?: string | null; lastError?: string | null };
export type PromptTemplateScope =
  | 'INTELLIGENCE_ANALYSIS'
  | 'SOURCE_VERIFICATION'
  | 'CREATIVE_OUTLINE_WECHAT'
  | 'CREATIVE_OUTLINE_XIAOHONGSHU'
  | 'CREATIVE_OUTLINE_ZHIHU'
  | 'CREATIVE_OUTLINE_WEIBO'
  | 'CREATIVE_DRAFT_WECHAT'
  | 'CREATIVE_DRAFT_XIAOHONGSHU'
  | 'CREATIVE_DRAFT_ZHIHU'
  | 'CREATIVE_DRAFT_WEIBO'
  | 'CREATIVE_REVISION_WECHAT'
  | 'CREATIVE_REVISION_XIAOHONGSHU'
  | 'CREATIVE_REVISION_ZHIHU'
  | 'CREATIVE_REVISION_WEIBO';
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
