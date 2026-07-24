import type { LocalState } from './localRepository';

const tokenKey = 'content-engine-web-session-v1';
const apiBase = import.meta.env.VITE_API_BASE ?? '/api/v1';

export type WebSession = { accessToken: string; user: { id: string; email: string; display_name?: string }; workspace: { id: string; name: string } };

function readSession(): WebSession | null {
  try { return JSON.parse(window.localStorage.getItem(tokenKey) ?? 'null') as WebSession | null; } catch { return null; }
}

async function request<T>(path: string, options: RequestInit = {}, authenticated = true): Promise<T> {
  const session = readSession();
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(authenticated && session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）。`);
  return payload as T;
}

export const webAuth = {
  session: readSession,
  clear: () => window.localStorage.removeItem(tokenKey),
  async register(input: { email: string; password: string; displayName: string; workspaceName: string }) {
    const result = await request<WebSession>('/auth/register', { method: 'POST', body: JSON.stringify(input) }, false);
    window.localStorage.setItem(tokenKey, JSON.stringify(result)); return result;
  },
  async login(input: { email: string; password: string }) {
    const result = await request<WebSession>('/auth/login', { method: 'POST', body: JSON.stringify(input) }, false);
    window.localStorage.setItem(tokenKey, JSON.stringify(result)); return result;
  },
  async me() { return request<{ user: WebSession['user']; workspace: WebSession['workspace'] }>('/auth/me'); },
};

export const webState = {
  async load() { return request<{ state: LocalState; revision: number; updatedAt: string }>('/workspace/state'); },
  async save(state: LocalState) { return request<{ revision: number; updatedAt: string }>('/workspace/state', { method: 'PUT', body: JSON.stringify({ state }) }); },
};

export const webIntelligence = {
  refreshRss: (sources: LocalState['sources']) => request<{ items: LocalState['intelligence']; results: { sourceId: string; ok: boolean; count: number; error?: string }[] }>('/intelligence/rss/refresh', { method: 'POST', body: JSON.stringify({ sources }) }),
  previewLink: (url: string) => request<{ url: string; title: string; summary: string; source: string }>('/intelligence/clip', { method: 'POST', body: JSON.stringify({ url }) }),
  webSearchStatus: () => request<{ configured: boolean }>('/settings/credentials/TAVILY'),
  saveWebSearchKey: (apiKey: string) => request<{ configured: boolean }>('/settings/credentials/TAVILY', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  searchWeb: (input: { query: string; category: string; domains: string[] }) => request<LocalState['intelligence']>('/intelligence/search', { method: 'POST', body: JSON.stringify(input) }),
};

export const webAgent = {
  credentialStatus: () => request<{ configured: boolean; updatedAt?: string | null }>('/settings/credentials/BAILIAN'),
  saveCredential: (apiKey: string) => request<{ configured: boolean }>('/settings/credentials/BAILIAN', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  policy: () => request<{ scope: string; configured?: boolean; model?: string }>('/agent/model-policies/AGENT_PLANNER'),
  savePolicy: (model: string) => request<{ scope: string; provider: string; model: string }>('/agent/model-policies/AGENT_PLANNER', { method: 'PUT', body: JSON.stringify({ model }) }),
};
