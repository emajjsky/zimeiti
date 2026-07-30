import type { CreativeVisualGenerationMode, CreativeVisualPlanItem, Platform } from './content';

export const VISUAL_PLAN_VERSION: number;

export interface VisualPlanInput {
  title: string;
  body: string;
  category?: string;
  coreMessage?: string;
}

export interface VisualPlanOptions {
  bodyItemCount?: number;
}

export interface VisualPlanCountRange {
  min: number;
  max: number;
}

export interface VisualGenerationContext {
  platform: Exclude<Platform, 'VIDEO_CHANNEL'>;
  title: string;
}

export interface VisualGenerationSpec {
  generationMode: CreativeVisualGenerationMode;
  prompt: string;
  negativePrompt: string;
}

export function visualPlanCountRange(platform: Exclude<Platform, 'VIDEO_CHANNEL'>): VisualPlanCountRange;
export function buildVisualGenerationSpec(item: CreativeVisualPlanItem, context: VisualGenerationContext, mode?: CreativeVisualGenerationMode): VisualGenerationSpec;
export function buildVisualPlan(input: VisualPlanInput, platform: Exclude<Platform, 'VIDEO_CHANNEL'>, options?: VisualPlanOptions): CreativeVisualPlanItem[];
export function mergeVisualPlan(generated: CreativeVisualPlanItem[], persisted?: CreativeVisualPlanItem[] | null, legacyAssetIds?: string[], legacyCoverId?: string | null, persistedVersion?: number): CreativeVisualPlanItem[];
export function resizeVisualPlan(generated: CreativeVisualPlanItem[], current?: CreativeVisualPlanItem[]): CreativeVisualPlanItem[];
