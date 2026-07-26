import type { Platform } from './content';

export type CreativeSkillDimension = 'SUBJECT' | 'CONTENT_TYPE' | 'VOICE' | 'LAYOUT' | 'CHANNEL';
export type CreativeSkillSelection = Record<CreativeSkillDimension, string>;

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
