import type { Platform } from './content';

export type CreativeSkillDimension = 'SUBJECT' | 'CONTENT_TYPE' | 'VOICE' | 'LAYOUT' | 'CHANNEL';
export type CreativeSkillSelection = Record<CreativeSkillDimension, string>;
export type VoiceOffset = 'DEFAULT' | 'MORE_RESTRAINED' | 'SHARPER' | 'MORE_PERSONAL' | 'MORE_NARRATIVE';

export interface AccountVoiceRules {
  opening: string;
  reasoning: string;
  rhythm: string;
  ending: string;
  identityBoundary: string;
  audience: string;
  readerTakeaway: string;
  allowedPhrases: string[];
  bannedPhrases: string[];
  bannedStructures: string[];
  hookPatterns: string[];
  argumentPattern: string;
  evidenceStyle: string;
  paragraphPattern: string;
  languageTexture: string;
  readerRelationship: string;
  titlePatterns: string[];
  closingStyle: string;
}

export interface AccountVoiceProfile {
  id: string;
  name: string;
  archetypeSlug: string;
  identityText: string;
  audienceText: string;
  readerTakeawayText: string;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
  rules: AccountVoiceRules;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface AccountVoiceInput {
  name: string;
  archetypeSlug: string;
  identityText: string;
  audienceText: string;
  readerTakeawayText: string;
  editedRules?: AccountVoiceRules;
}

export interface AccountVoiceCalibrationDraft extends AccountVoiceInput {
  editedRules: AccountVoiceRules;
  ruleSummary: string;
  analysis: {
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    voiceFingerprint: string;
    diagnostics: { dimension: string; finding: string; evidence: string }[];
  };
}
export type CreativePlatform = Exclude<Platform, 'VIDEO_CHANNEL'>;
export type CreativePlatformSkillSelection = { LAYOUT: string; CHANNEL: string; lengthTarget?: string };
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

export type ProjectInputPayload = Pick<ProjectInput, 'kind' | 'body' | 'scope' | 'platforms'> & { title?: string };

export interface ProjectReference {
  id: string;
  projectId: string;
  sourceType: 'LINK';
  role: ProjectReferenceRole;
  title: string;
  notes: string;
  url: string | null;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectReferenceMetadata = Pick<ProjectReference, 'role' | 'title' | 'notes' | 'scope' | 'platforms'>;

export type ProjectResearchRunStatus = 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type ProjectAgentStage = 'RESEARCH' | 'COPY' | 'VISUAL' | 'LAYOUT' | 'REVIEW';
export type ProjectAgentMessageType = 'MESSAGE' | 'CONFIRMATION' | 'RUN_STATUS' | 'ARTIFACT' | 'SYSTEM_EVENT';
export type ProjectAgentHistory = 'CURRENT' | 'ALL';
export type CopyAction = 'GENERATE_OUTLINE' | 'GENERATE_DRAFT' | 'POLISH_EXISTING_DRAFT' | 'RESTRUCTURE_DRAFT' | 'EXPAND_DRAFT' | 'SHORTEN_DRAFT' | 'REVISE_SELECTION' | 'ADAPT_PLATFORM';
export type ProjectArtifactType = 'RESEARCH_PLAN' | 'RESEARCH_SOURCES' | 'RESEARCH_VERIFICATION' | 'RESEARCH_RESULT' | 'OUTLINE' | 'CONTENT_MASTER' | 'PLATFORM_COPY';
export type ProjectArtifactStatus = 'CANDIDATE' | 'ACCEPTED' | 'REJECTED';

export interface ProjectAgentMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  runId: string | null;
  stage?: ProjectAgentStage;
  messageType?: ProjectAgentMessageType;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectStageSummary {
  id: string;
  stage: ProjectAgentStage;
  platform: CreativePlatform | null;
  summary: string;
  version: number;
  createdAt: string;
}

export interface ProjectAgentRun {
  id: string;
  action: CopyAction | 'PROJECT_RESEARCH_PLAN' | 'PROJECT_RESEARCH_SOURCES' | 'SOURCE_VERIFICATION' | 'PROJECT_RESEARCH_WORKFLOW';
  status: ProjectResearchRunStatus;
  request: string;
  confirmation: {
    model: string;
    promptVersion: number | string | null;
    skillNames: string[];
    materialCount: number;
    writeScope: string;
    sourceCounts?: { search: number; read: number; askUser: number; automatic: number };
    tools?: string[];
    phase?: 'PLANNING' | 'SOURCES' | 'VERIFYING' | 'COMPLETE';
    progress?: number;
  };
  error?: string;
  createdAt: string;
}

export interface ResearchResult {
  summary: string;
  researchBrief?: {
    subject: string;
    directions: string[];
    keywords: string[];
    preferredChannels: string[];
    searchQueries: string[];
  };
  facts: { claim: string; status: 'VERIFIED' | 'SINGLE_SOURCE'; explanation: string; evidence: unknown[] }[];
  cautions: { claim: string; status: 'SINGLE_SOURCE' | 'CONFLICTING' | 'NEEDS_REVIEW'; explanation: string; evidence: unknown[] }[];
  angles: string[];
  sources: { id: string; title: string; url: string | null; source: string }[];
  sourceAttempts?: {
    id: string;
    action: 'SEARCH_WEB' | 'READ_LINK' | 'ASK_USER';
    purpose: string;
    target: string;
    status: 'CAPTURED' | 'FAILED' | 'NEEDS_USER';
    title: string;
    url: string | null;
    source: string;
    error: string | null;
  }[];
  materialContext: {
    userContent: { id: string; title: string; body: string | null; kind: string }[];
    creativeReferences: { id: string; title: string; role: string }[];
    visualAssets: { id: string; title: string; role: string }[];
    verificationCandidates: { id: string; title: string; role: string }[];
  };
  process: { phase: 'COMPLETE'; sourceCount: number; sourceAttemptCount?: number; failedSourceCount?: number; verificationStatus?: 'COMPLETE' | 'PARTIAL' | 'FAILED'; verificationMessage?: string };
}

export interface ProjectArtifact {
  id: string;
  type: ProjectArtifactType;
  status: ProjectArtifactStatus;
  platform: CreativePlatform | null;
  version: number;
  parentArtifactId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  acceptedAt: string | null;
}

export interface ProjectAgentContext {
  stage: ProjectAgentStage;
  platform: CreativePlatform | null;
  messages: ProjectAgentMessage[];
  summaries: ProjectStageSummary[];
  activeRun: ProjectAgentRun | null;
  artifacts: ProjectArtifact[];
  usedMaterialIds: { inputIds: string[]; referenceIds: string[]; assetIds: string[] };
}

export interface ProjectAgentPrepareInput {
  stage: 'RESEARCH' | 'COPY';
  platform?: CreativePlatform;
  request: string;
  selection?: { text: string; start: number; end: number };
  inputIds: string[];
  referenceIds: string[];
  assetIds: string[];
}

export type ProjectAgentPrepareResult = ProjectAgentRun | { needsClarification: true; message: ProjectAgentMessage };

export interface ProjectResearchRun {
  id: string;
  status: ProjectResearchRunStatus;
  request: string;
  model: string;
  actionVersion: string;
  materialIds: { inputIds: string[]; referenceIds: string[]; assetIds: string[] };
  materialCount: number;
  error?: string;
  jobId?: string;
  createdAt: string;
}

export interface ProjectResearchPlan {
  id: string;
  runId: string;
  title: string;
  summary: string;
  questions: { question: string; why: string; preferredSources: string[] }[];
  claims: { claim: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }[];
  nextActions: { action: 'SEARCH_WEB' | 'READ_LINK' | 'ASK_USER'; purpose: string; target: string }[];
  createdAt: string;
}

export interface ProjectResearchContext {
  messages: ProjectAgentMessage[];
  run: ProjectResearchRun | null;
  plan: ProjectResearchPlan | null;
  usedMaterialIds: { inputIds: string[]; referenceIds: string[]; assetIds: string[] };
}

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
  accountVoiceProfileId: string;
  voiceOffset: VoiceOffset;
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
  platform: CreativePlatform;
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
  platform: CreativePlatform;
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
  platform: CreativePlatform;
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
