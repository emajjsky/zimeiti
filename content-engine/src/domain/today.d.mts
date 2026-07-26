import type { ProjectStatus } from './content';
import type { View } from '../app/navigation.mjs';

export function formatTodayTitle(value?: Date | string | number, timeZone?: string): string;
export function projectTaskMeta(status: ProjectStatus): { prefix: string; action: string; view: View } | null;
