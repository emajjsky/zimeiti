import type { ProjectAgentMessage } from './creative';

export const researchQuickAction: Readonly<{
  label: string;
  request: string;
}>;

export function canPrepareAgentRequest(input: {
  request: string;
  blockedReason?: string;
  busy: string;
  runIsActive: boolean;
}): boolean;

export function messagesForAgentThread<T extends Pick<ProjectAgentMessage, 'messageType'>>(messages: T[]): T[];
