const DIMENSIONS = ['SUBJECT', 'CONTENT_TYPE', 'VOICE', 'LAYOUT', 'CHANNEL'];

function skillView(row) {
  return {
    id: row.id,
    dimension: row.dimension,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    version: {
      id: row.version_id,
      version: row.version,
      instructions: row.instructions_md,
      rules: row.rules_json ?? {},
    },
  };
}

function briefView(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    objective: row.objective,
    targetAudience: row.target_audience,
    coreMessage: row.core_message,
    sourceRequirements: row.source_requirements,
    lengthTarget: row.length_target,
    selectedPlatforms: row.selected_platforms_json ?? [],
    notes: row.notes,
    selectedSkills: row.selected_versions_json ?? {},
    updatedAt: row.updated_at,
  };
}

function createCreativeSkillStore({ query, transaction }) {
  async function list(workspaceId) {
    const result = await query(`SELECT d.id, d.dimension, d.slug, d.name, d.description, d.sort_order,
      v.id AS version_id, v.version, v.instructions_md, v.rules_json
      FROM creative_skill_definitions d
      JOIN LATERAL (
        SELECT id, version, instructions_md, rules_json
        FROM creative_skill_versions
        WHERE definition_id = d.id
        ORDER BY created_at DESC, version DESC
        LIMIT 1
      ) v ON true
      WHERE d.enabled = true AND (d.workspace_id IS NULL OR d.workspace_id = $1)
      ORDER BY d.dimension, d.sort_order, d.name`, [workspaceId]);
    return result.rows.map(skillView);
  }

  async function getBrief(workspaceId, projectId) {
    const result = await query(`SELECT b.*, c.selected_versions_json
      FROM writing_briefs b
      JOIN creative_skill_compositions c ON c.id = b.composition_id
      WHERE b.workspace_id = $1 AND b.project_id = $2`, [workspaceId, projectId]);
    return briefView(result.rows[0]);
  }

  async function saveBrief(workspaceId, projectId, input) {
    const requested = DIMENSIONS.map((dimension) => input.selectedSkills[dimension]);
    const catalog = await query(`SELECT v.id, d.dimension
      FROM creative_skill_versions v
      JOIN creative_skill_definitions d ON d.id = v.definition_id
      WHERE v.id = ANY($1::text[]) AND d.enabled = true
        AND (d.workspace_id IS NULL OR d.workspace_id = $2)`, [requested, workspaceId]);
    const actual = new Map(catalog.rows.map((row) => [row.dimension, row.id]));
    const invalid = DIMENSIONS.find((dimension) => actual.get(dimension) !== input.selectedSkills[dimension]);
    if (invalid || catalog.rowCount !== DIMENSIONS.length) {
      const error = new Error('Skill 组合无效，请重新选择五个创作维度。');
      error.statusCode = 400;
      throw error;
    }

    return transaction(async (client) => {
      const composition = await client.query(`INSERT INTO creative_skill_compositions
        (workspace_id, project_id, selected_versions_json) VALUES ($1, $2, $3)
        ON CONFLICT (workspace_id, project_id) DO UPDATE SET
          selected_versions_json = excluded.selected_versions_json, updated_at = now()
        RETURNING id`, [workspaceId, projectId, JSON.stringify(input.selectedSkills)]);
      const result = await client.query(`INSERT INTO writing_briefs
        (workspace_id, project_id, composition_id, objective, target_audience, core_message,
         source_requirements, length_target, selected_platforms_json, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (workspace_id, project_id) DO UPDATE SET
          composition_id = excluded.composition_id, objective = excluded.objective,
          target_audience = excluded.target_audience, core_message = excluded.core_message,
          source_requirements = excluded.source_requirements, length_target = excluded.length_target,
          selected_platforms_json = excluded.selected_platforms_json, notes = excluded.notes,
          updated_at = now()
        RETURNING *`, [workspaceId, projectId, composition.rows[0].id, input.objective,
        input.targetAudience, input.coreMessage, input.sourceRequirements, input.lengthTarget,
        JSON.stringify(input.selectedPlatforms), input.notes]);
      return briefView({ ...result.rows[0], selected_versions_json: input.selectedSkills });
    });
  }

  return { list, getBrief, saveBrief };
}

module.exports = { DIMENSIONS, createCreativeSkillStore };
