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
  user: { id: string; email: string; display_name?: string; platformRole: 'SUPER_ADMIN' | 'USER'; status: 'ACTIVE' | 'DISABLED' };
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
};

export type ManagedUser = WebSession['user'] & {
  createdAt: string;
  updatedAt: string;
  workspaceCount: number;
};

export type RegistrationInvite = {
  id: string;
  code_hint: string;
  label: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
};

export type WorkspaceSession = Pick<WebSession, 'workspaces' | 'activeWorkspaceId'>;
