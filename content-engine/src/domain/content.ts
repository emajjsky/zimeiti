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

export type Platform = 'WECHAT' | 'XIAOHONGSHU' | 'VIDEO_CHANNEL';
export type ContentVersionStatus = 'DRAFT' | 'PREFLIGHT_PASSED' | 'WAITING_CONFIRMATION' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';

export interface IntelligenceItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  publishedAt: string;
  heat: number;
  trust: '可信' | '待核验';
  url?: string;
  captureMethod?: 'RSS' | 'MANUAL_LINK';
  language?: 'zh' | 'en' | 'other';
  note?: string;
  analysis?: {
    summary: string;
    heat: number;
    suggestedAngle: string;
    factsToVerify: string[];
    model: string;
    analyzedAt: string;
  };
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
  sourceIds: string[];
}

export interface ContentVersion {
  id: string;
  platform: Platform;
  status: ContentVersionStatus;
  title: string;
  body: string;
  updatedAt: string;
}

export interface ContentProject {
  id: string;
  title: string;
  status: ProjectStatus;
  coreViewpoint: string;
  factChecks: string[];
  versions: ContentVersion[];
  updatedAt: string;
}

export const platformName: Record<Platform, string> = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
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
