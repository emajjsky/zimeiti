import type { CreativeVisualPlanItem, Platform } from './content';

export interface VisualPlanInput {
  title: string;
  body: string;
  category?: string;
  coreMessage?: string;
}

export function buildVisualPlan(input: VisualPlanInput, platform: Exclude<Platform, 'VIDEO_CHANNEL'>): CreativeVisualPlanItem[];
export function mergeVisualPlan(generated: CreativeVisualPlanItem[], persisted?: CreativeVisualPlanItem[] | null, legacyAssetIds?: string[], legacyCoverId?: string | null): CreativeVisualPlanItem[];
