import type { CreativePlatform, ProjectMaterialScope, ProjectReferenceRole } from './creative';

export type AssetKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'OTHER';
export type AssetOrigin = 'UPLOAD' | 'AI_GENERATED' | 'WEB_IMPORT';
export type AssetStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETING';
export type AssetCopyrightStatus = 'PENDING' | 'OWNED' | 'LICENSED' | 'OPEN_LICENSE' | 'PROHIBITED';

export interface WorkspaceAsset {
  id: string;
  kind: AssetKind;
  origin: AssetOrigin;
  status: AssetStatus;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  sourceNote: string;
  copyrightStatus: AssetCopyrightStatus;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAsset extends WorkspaceAsset {
  linkId: string;
  projectId: string;
  role: ProjectReferenceRole;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  notes: string;
}

export type AssetFilters = Partial<Pick<WorkspaceAsset, 'kind' | 'origin'>> & {
  status?: Exclude<AssetStatus, 'DELETING'>;
  query?: string;
};

export type AssetMetadataInput = Pick<WorkspaceAsset, 'title' | 'sourceNote' | 'copyrightStatus'>;
export type AssetUpdateInput = AssetMetadataInput & { status: Exclude<AssetStatus, 'DELETING'> };
export type ProjectAssetLinkInput = Pick<ProjectAsset, 'role' | 'scope' | 'platforms' | 'notes'> & { title?: string };
