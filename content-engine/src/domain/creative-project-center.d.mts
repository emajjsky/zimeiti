import type { ContentProject, ProjectStage } from './content';

export type ProjectCenterFilterId = 'ALL' | 'PLANNING' | 'RESEARCH' | 'MASTER' | 'PLATFORM' | 'REVIEW' | 'COMPLETED';

export const projectCenterFilters: ReadonlyArray<{
  id: ProjectCenterFilterId;
  label: string;
  stages?: readonly ProjectStage[];
}>;

export function projectsForCenterFilter<T extends Pick<ContentProject, 'stage'>>(
  projects: T[],
  filter: ProjectCenterFilterId,
): T[];

export function selectedProjectIdForList<T extends Pick<ContentProject, 'id'>>(
  projects: T[],
  currentId: string,
): string;

export function projectCenterAction(stage: ProjectStage): string;
