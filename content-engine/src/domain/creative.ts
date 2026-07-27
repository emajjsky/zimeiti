import type { Platform } from './content';

export type CreativeSkillDimension = 'SUBJECT' | 'CONTENT_TYPE' | 'VOICE' | 'LAYOUT' | 'CHANNEL';
export type CreativeSkillSelection = Record<CreativeSkillDimension, string>;
export type CreativePlatform = Exclude<Platform, 'VIDEO_CHANNEL'>;
export type CreativePlatformSkillSelection = Record<'LAYOUT' | 'CHANNEL', string>;
export type CreativePlatformSkillMap = Partial<Record<CreativePlatform, CreativePlatformSkillSelection>>;
export type ProjectMaterialScope = 'PROJECT' | 'RESEARCH' | 'WRITING' | 'IMAGING';
export type ProjectInputKind = 'IDEA' | 'DRAFT' | 'NOTE' | 'TRANSCRIPT';
export type ProjectReferenceRole = 'FACT' | 'OPINION' | 'STRUCTURE' | 'VOICE' | 'HOOK' | 'VISUAL' | 'NEGATIVE';

export interface ProjectInput {
  id: string;
  projectId: string;
  kind: ProjectInputKind;
  title: string;
  body: string;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectInputPayload = Pick<ProjectInput, 'kind' | 'title' | 'body' | 'scope' | 'platforms'>;

export interface ProjectReference {
  id: string;
  projectId: string;
  sourceType: 'LINK' | 'FILE';
  role: ProjectReferenceRole;
  title: string;
  notes: string;
  url: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectReferenceMetadata = Pick<ProjectReference, 'role' | 'title' | 'notes' | 'scope' | 'platforms'>;

export interface CreativeSkillDefinition {
  id: string;
  dimension: CreativeSkillDimension;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  version: {
    id: string;
    version: string;
    instructions: string;
    rules: Record<string, unknown>;
  };
}

export interface WritingBrief {
  id: string;
  projectId: string;
  objective: string;
  targetAudience: string;
  coreMessage: string;
  sourceRequirements: string;
  lengthTarget: string;
  selectedPlatforms: Platform[];
  notes: string;
  selectedSkills: CreativeSkillSelection;
  platformSkills: CreativePlatformSkillMap;
  updatedAt: string;
}

export type WritingBriefInput = Omit<WritingBrief, 'id' | 'projectId' | 'updatedAt'>;

export type CreativeOutlineRunStatus = 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type CreativeOutlineCandidateStatus = 'CANDIDATE' | 'ACCEPTED' | 'REJECTED';

export interface CreativeOutlineSkillSnapshot {
  dimension: CreativeSkillDimension;
  name: string;
  version: string;
}

export interface CreativeOutlineConfirmation {
  model: string;
  platform: Exclude<Platform, 'VIDEO_CHANNEL'>;
  actionVersion: string;
  promptVersion: number;
  skills: CreativeOutlineSkillSnapshot[];
  costEstimate?: number | null;
}

export interface CreativeOutlinePreparation {
  id: string;
  status: 'DRAFT';
  createdAt: string;
  confirmation: CreativeOutlineConfirmation;
}

export interface CreativeOutlineRun extends Omit<CreativeOutlinePreparation, 'status'> {
  status: CreativeOutlineRunStatus;
  error?: string;
  jobId?: string;
}

export interface CreativeOutlineSection {
  heading: string;
  purpose: string;
  keyPoints: string[];
}

export interface CreativeOutlineCandidate {
  id: string;
  projectId: string;
  platform: Exclude<Platform, 'VIDEO_CHANNEL'>;
  status: CreativeOutlineCandidateStatus;
  selectedTitle: string | null;
  titleOptions: string[];
  summary: string;
  sections: CreativeOutlineSection[];
  factsToVerify: string[];
  model?: string;
  createdAt: string;
  acceptedAt: string | null;
}

export type CreativeDraftRunStatus = CreativeOutlineRunStatus;
export type CreativeDraftCandidateStatus = CreativeOutlineCandidateStatus;

export interface CreativeDraftConfirmation extends CreativeOutlineConfirmation {}

export interface CreativeDraftPreparation {
  id: string;
  status: 'DRAFT';
  createdAt: string;
  confirmation: CreativeDraftConfirmation;
}

export interface CreativeDraftRun extends Omit<CreativeDraftPreparation, 'status'> {
  status: CreativeDraftRunStatus;
  error?: string;
  jobId?: string;
}

export interface CreativeDraftCandidate {
  id: string;
  projectId: string;
  platform: Exclude<Platform, 'VIDEO_CHANNEL'>;
  outlineCandidateId: string;
  status: CreativeDraftCandidateStatus;
  title: string;
  body: string;
  factsToVerify: string[];
  model?: string;
  promptVersion?: number;
  createdAt: string;
  acceptedAt: string | null;
}
