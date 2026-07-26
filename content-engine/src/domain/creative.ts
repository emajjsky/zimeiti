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
