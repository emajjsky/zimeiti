export type ModelProvider = 'DASHSCOPE' | 'SILICONFLOW' | 'VOLCENGINE_ARK' | 'KIMI' | 'ZHIPU' | 'OPENAI' | 'OPENAI_COMPATIBLE';

export type ModelPurpose = 'INTELLIGENCE_SUMMARY' | 'INTELLIGENCE_FILTER' | 'TOPIC_RECOMMENDATION' | 'CONTENT_WRITING';

export type ModelTask =
  | 'INTELLIGENCE_ANALYSIS'
  | 'TOPIC_RECOMMENDATION'
  | 'CONTENT_WRITING'
  | 'CONTENT_REWRITE'
  | 'CONTENT_LAYOUT'
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'SPEECH_SYNTHESIS'
  | 'TEXT_TO_VIDEO'
  | 'IMAGE_TO_VIDEO'
  | 'FIRST_LAST_FRAME_TO_VIDEO'
  | 'REFERENCE_TO_VIDEO'
  | 'VIDEO_EDIT';

export type ModelRouteProvider = 'BAILIAN_CLI' | 'EXTERNAL_API';
export type ModelCapability = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'VISION' | 'MULTIMODAL' | 'ASR' | 'MUSIC' | 'REASONING' | 'EMBEDDING' | 'CODE';
export type ModelOperation = 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'TEXT_TO_VIDEO' | 'IMAGE_TO_VIDEO' | 'FIRST_LAST_FRAME_TO_VIDEO' | 'REFERENCE_TO_VIDEO' | 'VIDEO_EDIT';

export interface ModelCatalogItem {
  id: string;
  provider: ModelRouteProvider;
  connectionId?: string;
  connectionLabel: string;
  model: string;
  capabilities: ModelCapability[];
  operations?: ModelOperation[];
  origin?: 'ACCOUNT_CATALOG' | 'CLI_MEDIA';
  syncedAt?: string;
}

export interface ModelTaskPolicy {
  task: ModelTask;
  provider?: ModelRouteProvider;
  connectionId?: string;
  model?: string;
  fallbackProvider?: ModelRouteProvider;
  fallbackConnectionId?: string;
  fallbackModel?: string;
  updatedAt?: string;
}

export interface ApiUsageLog {
  id: string;
  task: ModelTask;
  provider: ModelRouteProvider;
  connectionLabel: string;
  model: string;
  status: 'SUCCESS' | 'ERROR';
  startedAt: string;
  durationMs: number;
  requestChars: number;
  responseChars: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface ApiUsageSummary {
  totalCalls: number;
  todayCalls: number;
  successCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export type BailianCapabilityScope = 'AUTO' | 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';

export interface BailianCliStatus {
  installed: boolean;
  version?: string;
  configured: boolean;
  scope: BailianCapabilityScope;
  status: 'UNCONFIGURED' | 'READY' | 'ERROR';
  lastTestedAt?: string;
  lastError?: string;
}

export interface BailianCliInput {
  apiKey?: string;
  scope: BailianCapabilityScope;
}

export interface ModelConnection {
  id: string;
  provider: ModelProvider;
  label: string;
  baseUrl: string;
  // New connections leave these legacy fields empty; models are selected in task policies.
  model: string;
  purposes: ModelPurpose[];
  status: 'UNTESTED' | 'READY' | 'ERROR';
  lastTestedAt?: string;
  lastError?: string;
  updatedAt?: string;
}

export interface ModelConnectionInput extends Omit<ModelConnection, 'id' | 'status' | 'lastTestedAt' | 'lastError'> {
  id?: string;
  apiKey?: string;
}
