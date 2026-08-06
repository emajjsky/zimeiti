import type { DraftPlatform, ChannelAccount, ContentDraft, ContentDraftVersion, PlatformDraftTask } from './content-drafts';

export interface PublishPackageAccount {
  id: string;
  name: string;
  mode: 'MANUAL' | 'OFFICIAL';
  externalAccountLabel: string;
}

export interface PublishPackage {
  schemaVersion: number;
  platform: DraftPlatform;
  account: PublishPackageAccount;
  project: { id: string; title: string };
  draftId: string;
  draftVersionId: string;
  versionNumber: number;
  title: string;
  body: string;
  html: string;
  coverAssetId: string | null;
  assets: Array<{ assetId: string; role: string; sortOrder: number }>;
  generatedAt: string;
  publishChecklist: string[];
}

export interface PublishReadyDraft {
  draft: ContentDraft;
  version: ContentDraftVersion;
  project: { id: string; title: string };
}

export interface MetricSnapshot {
  id: string;
  workspaceId: string;
  publicationId: string;
  capturedAt: string;
  source: 'MANUAL' | 'OFFICIAL_API';
  readCount: number;
  likeCount: number;
  shareCount: number;
  favoriteCount: number;
  commentCount: number;
  followerDelta: number;
  createdAt: string;
}

export interface Retrospective {
  id: string;
  workspaceId: string;
  publicationId: string;
  summary: string;
  highlights: string[];
  issues: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishedArticle {
  id: string;
  workspaceId: string;
  taskId: string | null;
  accountId: string;
  draftVersionId: string;
  platform: DraftPlatform;
  title: string;
  url: string;
  status: 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  accountName: string | null;
  projectTitle: string | null;
  latestMetrics: MetricSnapshot | null;
  retrospective: Retrospective | null;
}

export type { ChannelAccount, PlatformDraftTask };
