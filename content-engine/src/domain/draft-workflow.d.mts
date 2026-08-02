import type { DraftPlatform, ProjectWorkflowStage } from './content-drafts';

export type DraftWorkflowRoute = 'preparation' | 'copy' | 'visual' | 'layout' | 'drafts';

export interface DraftWorkflowStep {
  readonly id: DraftWorkflowRoute;
  readonly label: string;
  readonly stage: ProjectWorkflowStage;
}

export const draftWorkflowSteps: readonly DraftWorkflowStep[];
export function routeForProjectStage(stage: ProjectWorkflowStage): DraftWorkflowRoute;
export function canOpenDraftStep(stage: ProjectWorkflowStage, route: DraftWorkflowRoute | string): boolean;
export function draftImageLimit(platform: DraftPlatform | string): number;
