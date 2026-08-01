export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type WorkspaceStatus = 'ACTIVE' | 'DELETING';

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  status: WorkspaceStatus;
};

export type WebSession = {
  accessToken: string;
  user: { id: string; email: string; display_name?: string };
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
};

export type WorkspaceSession = Pick<WebSession, 'workspaces' | 'activeWorkspaceId'>;
