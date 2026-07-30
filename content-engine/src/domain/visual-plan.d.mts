import type { CreativeVisualPlanItem, Platform } from './content';

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

export function visualPlanCountRange(platform: Exclude<Platform, 'VIDEO_CHANNEL'>): VisualPlanCountRange;
export function buildVisualPlan(input: VisualPlanInput, platform: Exclude<Platform, 'VIDEO_CHANNEL'>, options?: VisualPlanOptions): CreativeVisualPlanItem[];
export function mergeVisualPlan(generated: CreativeVisualPlanItem[], persisted?: CreativeVisualPlanItem[] | null, legacyAssetIds?: string[], legacyCoverId?: string | null, persistedVersion?: number): CreativeVisualPlanItem[];
export function resizeVisualPlan(generated: CreativeVisualPlanItem[], current?: CreativeVisualPlanItem[]): CreativeVisualPlanItem[];
