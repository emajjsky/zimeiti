export type DraftPlatform = 'WECHAT' | 'XIAOHONGSHU' | 'WEIBO';
export type ProjectWorkflowStage = 'PREPARING' | 'WECHAT_WRITING' | 'WECHAT_IMAGING' | 'WECHAT_LAYOUT' | 'DRAFT_READY';
export type ContentDraftStatus = 'EDITING' | 'READY' | 'ARCHIVED';
export type DraftAssetRole = 'COVER' | 'BODY' | 'CARD' | 'MAIN';
export type WechatLayoutTemplateStatus = 'ACTIVE' | 'ARCHIVED';
export type WechatLayoutTemplateKind = 'SYSTEM' | 'CUSTOM';
export type ChannelAccountMode = 'MANUAL' | 'OFFICIAL';
export type ChannelAccountStatus = 'MANUAL_READY' | 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
export type PlatformDraftDeliveryMode = 'MANUAL' | 'OFFICIAL_API';
export type PlatformDraftTaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'MANUAL_PENDING'
  | 'MANUAL_CONFIRMED'
  | 'CANCELLED';

export interface DraftAsset {
  id: string;
  workspaceId: string;
  draftId: string;
  draftVersionId: string | null;
  assetId: string;
  role: DraftAssetRole;
  sortOrder: number;
  createdAt: string;
}

export interface ContentDraft {
  id: string;
  workspaceId: string;
  projectId: string;
  platform: DraftPlatform;
  status: ContentDraftStatus;
  revision: number;
  title: string;
  body: string;
  visualPlan: Record<string, unknown>;
  layoutTemplateVersionId: string | null;
  sourceDraftVersionId: string | null;
  sourceStale: boolean;
  currentVersionId: string | null;
  assets: DraftAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentDraftVersion {
  id: string;
  workspaceId: string;
  draftId: string;
  platform: DraftPlatform;
  versionNumber: number;
  title: string;
  body: string;
  visualPlan: Record<string, unknown>;
  renderedHtml: string | null;
  layoutTemplateVersionId: string | null;
  sourceDraftVersionId: string | null;
  generationRunId: string | null;
  assets: DraftAsset[];
  createdAt: string;
}

export interface WechatLayoutRules {
  schemaVersion: 1;
  canvas: { background: string; textColor: string; maxWidth: number };
  title: { fontSize: number; fontWeight: number; lineHeight: number; color: string };
  body: { fontSize: number; lineHeight: number; paragraphSpacing: number };
  heading: { fontSize: number; color: string; borderColor: string };
  quote: { background: string; borderColor: string };
  image: { borderRadius: number; spacing: number; captionColor: string };
  divider: { color: string; thickness: number };
}

export interface WechatLayoutTemplate {
  id: string;
  workspaceId: string;
  name: string;
  kind: WechatLayoutTemplateKind;
  status: WechatLayoutTemplateStatus;
  currentVersionId: string;
  currentVersionNumber: number;
  rules: WechatLayoutRules;
  sourceUrl: string | null;
  previewHtml: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelAccountCapability {
  canCreateDraft: boolean;
  verifiedAt: string | null;
  reason: string;
}

export interface ChannelAccount {
  id: string;
  workspaceId: string;
  platform: DraftPlatform;
  name: string;
  externalAccountLabel: string;
  mode: ChannelAccountMode;
  status: ChannelAccountStatus;
  capabilities: ChannelAccountCapability;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformDraftTask {
  id: string;
  workspaceId: string;
  accountId: string;
  draftVersionId: string;
  platform: DraftPlatform;
  mode: PlatformDraftDeliveryMode;
  status: PlatformDraftTaskStatus;
  idempotencyKey: string;
  packageAssetId: string | null;
  externalDraftId: string | null;
  responseSummary: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  manuallyConfirmedBy: string | null;
  manuallyConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftPatchInput {
  revision: number;
  title?: string;
  body?: string;
  visualPlan?: Record<string, unknown>;
  layoutTemplateVersionId?: string | null;
}

export interface DraftPreview {
  draftId: string;
  platform: DraftPlatform;
  html: string;
  checks: Array<{ code: string; level: 'ERROR' | 'WARNING'; message: string }>;
}
