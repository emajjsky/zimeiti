import type { CreativeVisualGenerationMode, CreativeVisualPlanItem, CreativeVisualStyleProfile, CreativeVisualType, Platform } from './content';

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
}

export interface VisualStylePresetDefinition {
  id: CreativeVisualStyleProfile['preset'];
  name: string;
  group: 'EDITORIAL' | 'KNOWLEDGE' | 'ILLUSTRATION' | 'CULTURAL' | 'TECHNOLOGY';
  description: string;
  swatches: string[];
  prompt: string;
  caseLabel: string;
  caseTitle: string;
  caseMeta: string;
}

export interface VisualTemplateDefinition {
  id: string;
  name: string;
  prompt: string;
}

export function visualPlanCountRange(platform: Exclude<Platform, 'VIDEO_CHANNEL'>): VisualPlanCountRange;
export function visualStylePresets(): VisualStylePresetDefinition[];
export function visualTemplatesFor(type: CreativeVisualType): VisualTemplateDefinition[];
export function buildVisualGenerationSpec(item: CreativeVisualPlanItem, context: VisualGenerationContext, mode?: CreativeVisualGenerationMode, styleProfile?: CreativeVisualStyleProfile): VisualGenerationSpec;
export function updateVisualPlanItem(item: CreativeVisualPlanItem, patch: Partial<CreativeVisualPlanItem>, context: VisualGenerationContext, styleProfile?: CreativeVisualStyleProfile): CreativeVisualPlanItem;
export function buildVisualPlan(input: VisualPlanInput, platform: Exclude<Platform, 'VIDEO_CHANNEL'>, options?: VisualPlanOptions): CreativeVisualPlanItem[];
export function replanVisualPlan(input: VisualPlanInput, platform: Exclude<Platform, 'VIDEO_CHANNEL'>, current: CreativeVisualPlanItem[], options?: VisualPlanOptions & { keepAssignedAssets?: boolean; styleProfile?: CreativeVisualStyleProfile }): CreativeVisualPlanItem[];
export function mergeVisualPlan(generated: CreativeVisualPlanItem[], persisted?: CreativeVisualPlanItem[] | null, legacyAssetIds?: string[], legacyCoverId?: string | null, persistedVersion?: number): CreativeVisualPlanItem[];
export function resizeVisualPlan(generated: CreativeVisualPlanItem[], current?: CreativeVisualPlanItem[]): CreativeVisualPlanItem[];
