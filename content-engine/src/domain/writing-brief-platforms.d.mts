import type { Platform } from './content';
import type { CreativePlatform } from './creative';

export interface WritingBriefPlatformContext {
  selectedPlatforms?: Platform[] | null;
  versionPlatforms?: Platform[] | null;
  plannedPlatforms?: Platform[] | null;
  activePlatform?: Platform | null;
}

export function resolveWritingBriefPlatforms(context: WritingBriefPlatformContext): CreativePlatform[];
export function shouldInitializeWritingBrief(stage: string): boolean;
