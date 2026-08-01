import type { WebSession } from '../domain/workspace';

const sessionKey = 'content-engine-web-session-v1';

function read(): WebSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(sessionKey) ?? 'null') as WebSession | null;
    if (!value?.accessToken || !value.user || !Array.isArray(value.workspaces)) return null;
    return value;
  } catch {
    return null;
  }
}

function write(session: WebSession) {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}

function clear() {
  window.localStorage.removeItem(sessionKey);
}

function setActiveWorkspace(workspaceId: string | null) {
  const session = read();
  if (!session) throw new Error('登录状态已失效，请重新登录。');
  if (workspaceId && !session.workspaces.some(({ id, status }) => id === workspaceId && status === 'ACTIVE')) {
    throw new Error('无法切换到这个工作空间。');
  }
  return write({ ...session, activeWorkspaceId: workspaceId });
}

export const sessionStore = { read, write, clear, setActiveWorkspace };
