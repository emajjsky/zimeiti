import type { CreateStageRoute } from '../app/navigation.mjs';
import type { ProjectPlanning, ProjectStage } from './content';

export const creativeStages: Array<{ id: CreateStageRoute; label: string; projectStage: Exclude<ProjectStage, 'COMPLETED'> }>;
export const planningFieldNames: string[];
export function stageRouteForProjectStage(projectStage: ProjectStage): CreateStageRoute;
export function canOpenCreateStage(projectStage: ProjectStage, routeStage: CreateStageRoute): boolean;
export function validatePlanningDraft(planning: ProjectPlanning): string[];
