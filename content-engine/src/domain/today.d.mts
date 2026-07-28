import type { ProjectStage } from './content';
import type { View } from '../app/navigation.mjs';

export function formatTodayTitle(value?: Date | string | number, timeZone?: string): string;
export function projectTaskMeta(stage: ProjectStage): { prefix: string; action: string; view: View } | null;
export function projectTaskEntries(projects: Array<{ id: string; title: string; stage: ProjectStage; updatedAt: string }>): Array<{
  id: string;
  projectId: string;
  title: string;
  sub: string;
  action: string;
  view: View;
}>;
export function completedProjects<T extends { stage: ProjectStage }>(projects: T[]): T[];
