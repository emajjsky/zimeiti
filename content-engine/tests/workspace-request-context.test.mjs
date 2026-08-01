import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [server, webApi, sessionStore, workspaceDomain, localRepository] = await Promise.all([
  readFile(new URL('../server/index.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/webApi.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/sessionStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/domain/workspace.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/localRepository.ts', import.meta.url), 'utf8'),
]);

test('服务端不再包含隐式首空间选择', () => {
  assert.doesNotMatch(server, /function currentWorkspace/);
  assert.doesNotMatch(server, /ORDER BY m\.role = 'OWNER'.*LIMIT 1/s);
  assert.doesNotMatch(server, /currentWorkspace\(/);
});

test('服务端注册空间管理 API 并用显式角色保护空间内请求', () => {
  assert.match(server, /app\.get\('\/api\/v1\/workspaces'/);
  assert.match(server, /app\.post\('\/api\/v1\/workspaces'/);
  assert.match(server, /app\.patch\('\/api\/v1\/workspaces\/:workspaceId'/);
  assert.match(server, /app\.put\('\/api\/v1\/me\/active-workspace'/);
  assert.match(server, /workspaceAccess\.forRole\('VIEWER'\)/);
  assert.match(server, /workspaceAccess\.forRole\('EDITOR'\)/);
  assert.match(server, /workspaceAccess\.forRole\('OWNER'\)/);
});

test('除身份和空间管理外的每个 API 都声明空间角色', () => {
  const unscopedPaths = new Set([
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/me',
    '/api/v1/workspaces',
    '/api/v1/workspaces/:workspaceId',
    '/api/v1/me/active-workspace',
  ]);
  const routes = [...server.matchAll(/app\.(?:get|post|put|patch|delete)\('([^']+)'(?:, \{ preHandler: ([^}]+) \})?/g)];
  const missing = routes
    .filter(([, path]) => path.startsWith('/api/v1/') && !unscopedPaths.has(path))
    .filter(([, , preHandler]) => !preHandler?.includes('workspaceAccess.forRole'))
    .map(([, path]) => path);
  assert.deepEqual(missing, []);
});

test('Web API 为全部空间内请求注入当前空间', () => {
  assert.match(webApi, /'X-Workspace-Id': session\.activeWorkspaceId/);
  assert.match(webApi, /workspaceScoped = true/);
  assert.match(webApi, /auth\/me[\s\S]*workspaceScoped: false/);
  assert.match(webApi, /requestWorkspaceContent[\s\S]*'X-Workspace-Id'/);
  assert.match(webApi, /projectFile[\s\S]*requestWorkspaceContent\(`\/creative\/project-files/);
  assert.match(webApi, /content\(assetId[\s\S]*requestWorkspaceContent\(`\/assets/);
});

test('客户端会话只保存空间列表和当前空间 ID', () => {
  assert.match(workspaceDomain, /export type WorkspaceSummary/);
  assert.match(workspaceDomain, /activeWorkspaceId: string \| null/);
  assert.match(sessionStore, /setActiveWorkspace/);
  assert.doesNotMatch(webApi, /workspace: \{ id: string; name: string \}/);
  assert.doesNotMatch(localRepository, /content-engine-web-session-v1/);
});

test('工作空间名称和素材目录不再写入空间偏好快照', () => {
  const defaultStateBody = server.match(/function defaultState\(name\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(defaultStateBody, /materialRoot/);
  assert.doesNotMatch(defaultStateBody, /workspace: \{ name/);
  const preferencesRoute = server.slice(server.indexOf("app.patch('/api/v1/workspace/preferences'"), server.indexOf("app.get('/api/v1/settings/credentials'"));
  assert.doesNotMatch(preferencesRoute, /materialRoot/);
  const workspaceSchema = preferencesRoute.match(/workspace: z\.object\(\{([\s\S]*?)\}\)\.optional\(\)/)?.[1] ?? '';
  assert.doesNotMatch(workspaceSchema, /name: z\.string/);
});
