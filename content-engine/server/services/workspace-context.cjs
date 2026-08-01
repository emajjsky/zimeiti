const { businessError } = require('./business-errors.cjs');
const { resolveWorkspaceMembership } = require('./workspaces.cjs');

function createWorkspaceAccess({ query, authenticate }) {
  async function resolve(request, minimumRole = 'VIEWER') {
    const workspaceId = String(request.headers['x-workspace-id'] ?? '').trim();
    if (!workspaceId) throw businessError(400, 'WORKSPACE_REQUIRED', '请选择工作空间后再继续。');
    request.workspace = await resolveWorkspaceMembership(query, request.user.sub, workspaceId, minimumRole);
  }

  return {
    resolve,
    forRole: (role) => [authenticate, (request) => resolve(request, role)],
  };
}

module.exports = { createWorkspaceAccess };
