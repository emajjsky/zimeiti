export type TopicStatus = 'PENDING' | 'ACCEPTED' | 'PROJECT_CREATED' | 'DISCARDED';
export type ProjectStatus =
  | 'BRIEF'
  | 'WRITING'
  | 'VISUAL'
  | 'VIDEO'
  | 'REVIEW'
  | 'SCHEDULED'
  | 'PARTIALLY_PUBLISHED'
  | 'PUBLISHED'
  | 'RETROSPECTIVE'
  | 'ARCHIVED';

export type ProjectOriginType = 'HOTSPOT' | 'MANUAL' | 'DRAFT' | 'IMPORT' | 'LEGACY';
export type ProjectStage =
  | 'PLANNING'
  | 'RESEARCH'
  | 'MASTER_WRITING'
  | 'PLATFORM_ADAPTATION'
  | 'VISUAL'
  | 'LAYOUT'
  | 'REVIEW'
  | 'COMPLETED';

export type Platform = 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO' | 'VIDEO_CHANNEL';
export type ContentVersionStatus = 'DRAFT' | 'PREFLIGHT_PASSED' | 'WAITING_CONFIRMATION' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';

export type AnalysisDecision = 'FOLLOW' | 'WATCH' | 'SKIP';
export type TimingWindow = 'TODAY' | 'THREE_DAYS' | 'ONE_WEEK' | 'EVERGREEN';
export type AnalysisDimension = { score: number; reason: string };
export type AnalysisAngle = { title: string; coreViewpoint: string; targetAudience: string };
export type PlatformRecommendation = { platform: Platform; fitScore: number; recommendedFormat: string; reason: string };
export interface IntelligenceAnalysis {
  id: string;
  selectedPlatforms: Platform[];
  decisionReason: string;
  timingWindow: TimingWindow;
  dimensions: { timeliness: AnalysisDimension; accountFit: AnalysisDimension; contentValue: AnalysisDimension; spreadPotential: AnalysisDimension; feasibilityAndSafety: AnalysisDimension };
  angles: AnalysisAngle[];
  platforms: PlatformRecommendation[];
  factsToVerify: string[];
  risks: string[];
  overallScore: number;
  decision: AnalysisDecision;
  model: string;
  promptVersion: string;
  analyzedAt: string;
}

export interface IntelligenceItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  keywords?: string[];
  source: string;
  publishedAt: string;
  heat: number;
  trust: '可信' | '待核验';
  url?: string;
  captureMethod?: 'RSS' | 'MANUAL_LINK' | 'SEARCH';
  language?: 'zh' | 'en' | 'other';
  note?: string;
  analysis?: IntelligenceAnalysis;
}

export interface IntelligenceSource {
  id: string;
  name: string;
  type: 'RSS';
  url: string;
  category: string;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  language?: 'ALL' | 'ZH' | 'EN';
  enabled: boolean;
  refreshMinutes: number;
  trust: IntelligenceItem['trust'];
  lastSyncedAt?: string;
  lastError?: string;
}

export interface TopicCandidate {
  id: string;
  title: string;
  category: string;
  platforms: Platform[];
  urgency: '高' | '中' | '低';
  status: TopicStatus;
  plannedDate?: string;
  coreViewpoint: string;
  targetAudience?: string;
  factsToVerify?: string[];
  sourceIds: string[];
  analysisSnapshot?: {
    score: number;
    decision: AnalysisDecision;
    reason: string;
    timingWindow: TimingWindow;
    platformRecommendations: PlatformRecommendation[];
  };
}

export interface ContentVersion {
  id: string;
  platform: Platform;
  status: ContentVersionStatus;
  title: string;
  body: string;
  updatedAt: string;
}

export interface ProjectPlanning {
  title: string;
  category: string;
  angle: string;
  objective: string;
  targetAudience: string;
  coreMessage: string;
  targetPlatforms: Platform[];
  timing: TimingWindow;
  plannedPublishAt?: string;
  sourceRequirements: string;
  constraints: string;
}

export interface CreativeVisualAsset {
  referenceId: string;
  title: string;
  role: 'COVER' | 'BODY';
  url?: string | null;
}

export interface CreativeLayoutDocument {
  platform: Exclude<Platform, 'VIDEO_CHANNEL'>;
  format: 'HTML' | 'MARKDOWN';
  content: string;
  generatedAt: string;
}

export interface CreativeDelivery {
  visual: { coverReferenceId: string | null; assetReferenceIds: string[]; assets: CreativeVisualAsset[]; updatedAt: string } | null;
  layouts: Partial<Record<Exclude<Platform, 'VIDEO_CHANNEL'>, CreativeLayoutDocument>>;
  review: { acknowledgedFactChecks: string[]; completedAt: string } | null;
}

export interface ContentProject {
  id: string;
  title: string;
  originType: ProjectOriginType;
  originReferenceId?: string;
  legacyTopicId?: string;
  stage: ProjectStage;
  status: ProjectStatus;
  planning: ProjectPlanning;
  planningVersion: number;
  planningConfirmedAt?: string;
  coreViewpoint: string;
  factChecks: string[];
  versions: ContentVersion[];
  sourceSnapshot: Record<string, unknown>;
  delivery?: CreativeDelivery;
  createdAt: string;
  updatedAt: string;
}

export const platformName: Record<Platform, string> = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  ZHIHU: '知乎',
  WEIBO: '微博',
  VIDEO_CHANNEL: '视频号',
};

export const projectStatusName: Record<ProjectStatus, string> = {
  BRIEF: '策划中',
  WRITING: '写作中',
  VISUAL: '视觉制作中',
  VIDEO: '视频制作中',
  REVIEW: '待审核',
  SCHEDULED: '待排期',
  PARTIALLY_PUBLISHED: '部分已发布',
  PUBLISHED: '已发布',
  RETROSPECTIVE: '待复盘',
  ARCHIVED: '已归档',
};

export const projectStageName: Record<ProjectStage, string> = {
  PLANNING: '待规划',
  RESEARCH: '研究中',
  MASTER_WRITING: '正文中',
  PLATFORM_ADAPTATION: '平台制作中',
  VISUAL: '配图中',
  LAYOUT: '排版中',
  REVIEW: '待审核',
  COMPLETED: '已完成',
};

export const projectOriginName: Record<ProjectOriginType, string> = {
  HOTSPOT: '热点',
  MANUAL: '手工想法',
  DRAFT: '已有草稿',
  IMPORT: '导入内容',
  LEGACY: '历史项目',
};

export function projectStageForLegacyStatus(status: ProjectStatus): ProjectStage {
  if (status === 'BRIEF') return 'PLANNING';
  if (status === 'WRITING') return 'MASTER_WRITING';
  if (status === 'VISUAL' || status === 'VIDEO') return 'VISUAL';
  if (status === 'REVIEW' || status === 'SCHEDULED') return 'REVIEW';
  return 'COMPLETED';
}
