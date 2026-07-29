const DIMENSIONS = ['SUBJECT', 'CONTENT_TYPE', 'VOICE', 'LAYOUT', 'CHANNEL'];
const WRITING_DIMENSIONS = ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL'];
const PLATFORM_NAMES = { WECHAT: '公众号', XIAOHONGSHU: '小红书', ZHIHU: '知乎', WEIBO: '微博' };

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
    accountVoiceProfileId: row.account_voice_profile_id ?? '',
    voiceOffset: row.voice_offset ?? 'DEFAULT',
    selectedSkills: row.selected_versions_json ?? {},
    platformSkills: row.platform_versions_json ?? {},
    updatedAt: row.updated_at,
  };
}

function createCreativeSkillStore({ query, transaction, accountVoiceStore = null }) {
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
    const result = await query(`SELECT b.*, c.selected_versions_json, c.platform_versions_json
      FROM writing_briefs b
      JOIN creative_skill_compositions c ON c.id = b.composition_id
      WHERE b.workspace_id = $1 AND b.project_id = $2`, [workspaceId, projectId]);
    return briefView(result.rows[0]);
  }

  async function getContext(workspaceId, projectId, platform) {
    const brief = await getBrief(workspaceId, projectId);
    if (!brief) return null;
    const platformSelection = brief.platformSkills[platform];
    if (!platformSelection?.CHANNEL) throw new Error(`请先配置${PLATFORM_NAMES[platform] ?? '当前平台'}写作规则。`);
    const requested = [brief.selectedSkills.SUBJECT, brief.selectedSkills.CONTENT_TYPE, platformSelection.CHANNEL];
    const result = await query(`SELECT d.id, d.dimension, d.slug, d.name, d.description, d.sort_order,
      v.id AS version_id, v.version, v.instructions_md, v.rules_json
      FROM creative_skill_versions v
      JOIN creative_skill_definitions d ON d.id = v.definition_id
      WHERE v.id = ANY($1::text[]) AND d.enabled = true
        AND (d.workspace_id IS NULL OR d.workspace_id = $2)`, [requested, workspaceId]);
    const byVersion = new Map(result.rows.map((row) => [row.version_id, skillView(row)]));
    const skills = requested.map((id) => byVersion.get(id)).filter(Boolean);
    if (skills.length !== WRITING_DIMENSIONS.length) throw new Error('项目绑定的写作策略已不可用，请重新保存写作策略。');
    if (!brief.accountVoiceProfileId) throw new Error('请先在设置中创建并选择账号声音后再生成正文。');
    const accountVoice = await accountVoiceStore?.getWritingSnapshot(workspaceId, brief.accountVoiceProfileId, brief.voiceOffset);
    if (!accountVoice) throw new Error('当前账号声音不可用，请在设置中重新选择。');
    return { brief, skills, accountVoice };
  }

  async function saveBrief(workspaceId, projectId, input) {
    const shared = ['SUBJECT', 'CONTENT_TYPE', 'VOICE'];
    const requestedPairs = [
      ...shared.map((dimension) => [dimension, input.selectedSkills[dimension]]),
      ...input.selectedPlatforms.map((platform) => ['CHANNEL', input.platformSkills[platform]?.CHANNEL]),
      ...input.selectedPlatforms.flatMap((platform) => input.platformSkills[platform]?.LAYOUT ? [['LAYOUT', input.platformSkills[platform].LAYOUT]] : []),
    ];
    if (requestedPairs.some(([, id]) => !id)) {
      const error = new Error('写作策略无效，请选择题材、内容类型、语言风格，并确保平台写作规则可用。');
      error.statusCode = 400;
      throw error;
    }
    const requested = [...new Set(requestedPairs.map(([, id]) => id))];
    const catalog = await query(`SELECT v.id, d.dimension
      FROM creative_skill_versions v
      JOIN creative_skill_definitions d ON d.id = v.definition_id
      WHERE v.id = ANY($1::text[]) AND d.enabled = true
        AND (d.workspace_id IS NULL OR d.workspace_id = $2)`, [requested, workspaceId]);
    const actual = new Map(catalog.rows.map((row) => [row.id, row.dimension]));
    const invalid = requestedPairs.find(([dimension, id]) => actual.get(id) !== dimension);
    if (invalid || catalog.rowCount !== requested.length) {
      const error = new Error('写作策略无效，请重新选择可用规则。');
      error.statusCode = 400;
      throw error;
    }

    return transaction(async (client) => {
      const composition = await client.query(`INSERT INTO creative_skill_compositions
        (workspace_id, project_id, selected_versions_json, platform_versions_json) VALUES ($1, $2, $3, $4)
        ON CONFLICT (workspace_id, project_id) DO UPDATE SET
          selected_versions_json = excluded.selected_versions_json,
          platform_versions_json = excluded.platform_versions_json, updated_at = now()
        RETURNING id`, [workspaceId, projectId, JSON.stringify(input.selectedSkills), JSON.stringify(input.platformSkills)]);
      const result = await client.query(`INSERT INTO writing_briefs
        (workspace_id, project_id, composition_id, objective, target_audience, core_message,
         source_requirements, length_target, selected_platforms_json, notes, account_voice_profile_id, voice_offset)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (workspace_id, project_id) DO UPDATE SET
          composition_id = excluded.composition_id, objective = excluded.objective,
          target_audience = excluded.target_audience, core_message = excluded.core_message,
          source_requirements = excluded.source_requirements, length_target = excluded.length_target,
          selected_platforms_json = excluded.selected_platforms_json, notes = excluded.notes,
          account_voice_profile_id = excluded.account_voice_profile_id, voice_offset = excluded.voice_offset,
          updated_at = now()
        RETURNING *`, [workspaceId, projectId, composition.rows[0].id, input.objective,
        input.targetAudience, input.coreMessage, input.sourceRequirements, input.lengthTarget,
        JSON.stringify(input.selectedPlatforms), input.notes, input.accountVoiceProfileId || null, input.voiceOffset]);
      return briefView({ ...result.rows[0], account_voice_profile_id: input.accountVoiceProfileId || null, voice_offset: input.voiceOffset, selected_versions_json: input.selectedSkills, platform_versions_json: input.platformSkills });
    });
  }

  return { list, getBrief, getContext, saveBrief };
}

module.exports = { DIMENSIONS, WRITING_DIMENSIONS, createCreativeSkillStore };
