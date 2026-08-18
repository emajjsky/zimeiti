export type ContentIngestionInputKind = 'URL' | 'TEXT' | 'ASSET' | 'COMPOSITE';
export type ContentIngestionSourceType = 'GENERIC_WEB' | 'WECHAT' | 'ZHIHU' | 'X' | 'UPLOAD';
export type ContentIngestionIntent = 'REFERENCE' | 'AUTHOR_CONTENT' | 'DISCOVERY' | 'VOICE_SAMPLE';
export type ContentIngestionCompleteness = 'FULL' | 'PARTIAL';
export type ContentIngestionStage = 'PENDING' | 'FETCHING' | 'PARSING' | 'DOWNLOADING_MEDIA' | 'ANALYZING' | 'READY' | 'PARTIAL' | 'NEEDS_USER_INPUT' | 'FAILED' | 'CANCELLED';
export type ContentIngestionProcessingKind = 'TEXT' | 'DOCUMENT' | 'MULTIMODAL';

export interface NormalizedBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'quote' | 'list' | 'image' | 'embed' | 'threadItem' | 'transcriptSegment';
  text?: string;
  level?: number;
  items?: string[];
  sourcePosition?: number;
  mediaCandidateId?: string;
  startMs?: number;
  endMs?: number;
}

export interface NormalizedDocument {
  schemaVersion: 1;
  title: string;
  author?: string;
  publishedAt?: string;
  canonicalUrl?: string;
  language?: string;
  blocks: NormalizedBlock[];
  plainText: string;
  mediaCandidateIds: string[];
  understanding?: {
    scope: 'CONTENT_UNDERSTANDING';
    model: string;
    result: { summary: string; coreViewpoints: string[]; structureOutline: string[]; reusableElements: string[]; visualClues: string[] };
  };
  extraction: { adapter: string; adapterVersion: string; fetchedAt: string; contentHash: string; completeness: ContentIngestionCompleteness; warnings: string[] };
}

export interface ContentIngestion {
  id: string;
  projectId: string | null;
  jobId: string | null;
  inputKind: ContentIngestionInputKind;
  sourceType: ContentIngestionSourceType;
  processingKind: ContentIngestionProcessingKind;
  intent: ContentIngestionIntent;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  stage: ContentIngestionStage;
  completeness: ContentIngestionCompleteness | null;
  document: NormalizedDocument | null;
  media: ContentIngestionMedia[];
  warnings: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentIngestionMedia {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO';
  blockId: string | null;
  sourceUrl: string;
  resolvedUrl: string;
  altText: string;
  caption: string;
  width: number | null;
  height: number | null;
  position: number | null;
  classification: 'CONTENT' | 'AVATAR' | 'LOGO' | 'AD' | 'QR' | 'DECORATION' | 'UNKNOWN';
  copyrightStatus: 'PENDING' | 'OWNED' | 'LICENSED' | 'OPEN_LICENSE' | 'PROHIBITED';
  selected: boolean;
  assetId: string | null;
}
