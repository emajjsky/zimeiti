import type { CreateStageRoute } from '../app/navigation.mjs';
import type { ProjectPlanning, ProjectStage } from './content';
import type { ProjectWorkflowStage } from './content-drafts';

export const creativeStages: Array<{ id: CreateStageRoute; label: string; projectStage: ProjectWorkflowStage }>;
export const planningFieldNames: string[];
export function stageRouteForProjectStage(projectStage: ProjectStage): CreateStageRoute;
export function canOpenCreateStage(projectStage: ProjectStage, routeStage: CreateStageRoute): boolean;
export function validatePlanningDraft(planning: ProjectPlanning): string[];
