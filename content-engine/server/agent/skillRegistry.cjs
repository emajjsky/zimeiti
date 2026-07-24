const { query } = require('../db.cjs');

async function listAvailableSkills(workspaceId) {
  const result = await query(`SELECT d.id AS skill_id, d.name, d.description, d.execution_target, v.id AS version_id, v.version, v.manifest_json
    FROM skill_definitions d
    JOIN skill_versions v ON v.skill_id = d.id
    WHERE d.enabled = true AND (d.workspace_id IS NULL OR d.workspace_id = $1)
    ORDER BY d.workspace_id NULLS LAST, d.id, v.version DESC`, [workspaceId]);
  const latest = new Map();
  for (const row of result.rows) if (!latest.has(row.skill_id)) latest.set(row.skill_id, row);
  return [...latest.values()].map((row) => ({ skillId: row.skill_id, skillVersionId: row.version_id, name: row.name, description: row.description, executionTarget: row.execution_target, manifest: row.manifest_json }));
}

function plannerSkillView(skills) {
  return skills.map((skill) => ({ skillVersionId: skill.skillVersionId, name: skill.name, description: skill.description, executionTarget: skill.executionTarget, scope: skill.manifest.scope, outputs: skill.manifest.outputs, requiresConfirmation: skill.manifest.requiresConfirmation }));
}

module.exports = { listAvailableSkills, plannerSkillView };
