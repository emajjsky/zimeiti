import type { ProjectStatus } from './content';
import type { View } from '../app/navigation.mjs';

export function formatTodayTitle(value?: Date | string | number, timeZone?: string): string;
export function projectTaskMeta(status: ProjectStatus): { prefix: string; action: string; view: View } | null;
export function projectTaskEntries(projects: Array<{ id: string; title: string; status: ProjectStatus; updatedAt: string }>): Array<{
  id: string;
  projectId: string;
  title: string;
  sub: string;
  action: string;
  view: View;
}>;
