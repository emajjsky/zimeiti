const STAGES = ['RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW'];

function messageView(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    runId: row.action_run_id ?? null,
    stage: row.stage,
    messageType: row.message_type,
    artifactRefs: row.artifact_refs_json ?? [],
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

function summaryView(row) {
  return {
    id: row.id,
    stage: row.stage,
    platform: row.platform ?? null,
    summary: row.summary,
    version: Number(row.version),
    createdAt: row.created_at,
  };
}

function actionName(actionVersionId) {
  if (String(actionVersionId).startsWith('project-research-workflow:')) return 'PROJECT_RESEARCH_WORKFLOW';
  if (String(actionVersionId).startsWith('project-research-plan:')) return 'PROJECT_RESEARCH_PLAN';
  if (String(actionVersionId).startsWith('project-research-sources:')) return 'PROJECT_RESEARCH_SOURCES';
  if (String(actionVersionId).startsWith('source-verification:')) return 'SOURCE_VERIFICATION';
  return String(actionVersionId).replace(/^project-copy-/, '').replace(/:[^:]+$/, '').replace(/-/g, '_').toUpperCase();
}

function runView(row) {
  if (!row) return null;
  const snapshot = row.source_snapshot_json ?? {};
  const input = row.input_json ?? {};
  const materials = Array.isArray(snapshot.materials) ? snapshot.materials : [];
  const skills = Array.isArray(snapshot.skills) ? snapshot.skills : [];
  const sourceCounts = snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : undefined;
  const process = snapshot.process && typeof snapshot.process === 'object' ? snapshot.process : undefined;
  return {
    id: row.id,
    action: actionName(row.action_version_id),
    status: row.status,
    request: snapshot.request ?? '',
    confirmation: {
      model: row.model ?? input.route?.model ?? '',
      promptVersion: row.prompt_version ?? null,
      skillNames: skills.map((skill) => skill.name).filter(Boolean),
      materialCount: materials.length,
      writeScope: snapshot.platform ?? snapshot.stage ?? 'RESEARCH',
      ...(sourceCounts ? { sourceCounts, tools: Array.isArray(snapshot.tools) ? snapshot.tools : [] } : {}),
      ...(process ? { phase: process.phase, progress: process.progress } : {}),
    },
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
  };
}

function artifactView(row) {
  return {
    id: row.id,
    type: row.artifact_type,
    status: row.status,
    platform: row.platform ?? null,
    version: Number(row.version_number ?? 1),
    parentArtifactId: row.parent_artifact_id ?? null,
    payload: row.payload_json ?? {},
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
  };
}

function createProjectAgentStore({ query, transaction }) {
  async function context(workspaceId, projectId, filter) {
    const stage = filter.stage;
    const platform = filter.platform ?? null;
    const history = filter.history ?? 'CURRENT';
    const messageQuery = history === 'ALL'
      ? `SELECT * FROM (
          SELECT id, role, content, action_run_id, stage, message_type, artifact_refs_json, metadata_json, created_at
          FROM project_agent_messages
          WHERE workspace_id = $1 AND project_id = $2
          ORDER BY created_at DESC LIMIT 200
        ) recent ORDER BY created_at ASC`
      : `SELECT * FROM (
          SELECT id, role, content, action_run_id, stage, message_type, artifact_refs_json, metadata_json, created_at
          FROM project_agent_messages
          WHERE workspace_id = $1 AND project_id = $2 AND stage = $3
            AND ($4::text IS NULL OR metadata_json->>'platform' IS NULL OR metadata_json->>'platform' = $4)
          ORDER BY created_at DESC LIMIT 100
        ) recent ORDER BY created_at ASC`;
    const messageParams = history === 'ALL' ? [workspaceId, projectId] : [workspaceId, projectId, stage, platform];

    const [messages, summaries, activeRun, artifacts, materials] = await Promise.all([
      query(messageQuery, messageParams),
      query(`SELECT DISTINCT ON (stage, platform)
          id, stage, platform, summary, version, created_at
        FROM project_stage_summaries
        WHERE workspace_id = $1 AND project_id = $2
          AND array_position($5::text[], stage) < array_position($5::text[], $3)
          AND ($4::text IS NULL OR platform IS NULL OR platform = $4)
        ORDER BY stage, platform, version DESC`, [workspaceId, projectId, stage, platform, STAGES]),
      query(`SELECT r.*
        FROM generation_runs r
        WHERE r.workspace_id = $1 AND r.source_snapshot_json->>'projectId' = $2
          AND (($3 = 'RESEARCH' AND (r.action_version_id LIKE 'project-research-workflow:%' OR r.action_version_id LIKE 'project-research-plan:%' OR r.action_version_id LIKE 'project-research-sources:%' OR r.action_version_id LIKE 'source-verification:%'))
            OR ($3 = 'COPY' AND r.action_version_id LIKE 'project-copy-%'))
          AND ($4::text IS NULL OR r.source_snapshot_json->>'platform' = $4)
          AND r.status IN ('DRAFT', 'QUEUED', 'RUNNING')
        ORDER BY r.created_at DESC LIMIT 1`, [workspaceId, projectId, stage, platform]),
      query(`SELECT a.*,
          COALESCE(rp.output_json, cm.payload_json, pc.payload_json, a.metadata_json->'payload', '{}'::jsonb) AS payload_json,
          COALESCE(cm.version_number, pc.version_number, 1) AS version_number,
          COALESCE(parent_cm.artifact_id, parent_pc.artifact_id) AS parent_artifact_id
        FROM project_artifacts a
        LEFT JOIN project_research_plans rp ON rp.artifact_id = a.id
        LEFT JOIN LATERAL (
          SELECT m.version_number,
            jsonb_build_object(
              'thesis', m.thesis,
              'facts', m.facts_json,
              'cases', m.cases_json,
              'preservedExpressions', m.preserved_expressions_json,
              'factsToVerify', m.facts_to_verify_json,
              'materialRefs', m.material_refs_json
            ) AS payload_json,
            m.parent_version_id
          FROM content_master_versions m WHERE m.artifact_id = a.id
        ) cm ON true
        LEFT JOIN content_master_versions parent_cm ON parent_cm.id = cm.parent_version_id
        LEFT JOIN LATERAL (
          SELECT v.version_number,
            jsonb_build_object(
              'title', v.title,
              'body', v.body,
              'factsToVerify', v.facts_to_verify_json,
              'changeSummary', v.change_summary,
              'qualityReview', a.metadata_json->'payload'->'qualityReview'
            ) AS payload_json,
            v.parent_version_id
          FROM platform_content_versions v WHERE v.artifact_id = a.id
        ) pc ON true
        LEFT JOIN platform_content_versions parent_pc ON parent_pc.id = pc.parent_version_id
        WHERE a.workspace_id = $1 AND a.project_id = $2
          AND ($3::text IS NULL OR a.platform IS NULL OR a.platform = $3)
        ORDER BY a.created_at DESC LIMIT 20`, [workspaceId, projectId, platform]),
      query(`SELECT m.input_id, m.reference_id
        FROM project_research_materials m
        JOIN project_research_plans p ON p.generation_run_id = m.generation_run_id
        WHERE p.workspace_id = $1 AND p.project_id = $2
          AND p.generation_run_id = (
            SELECT generation_run_id FROM project_research_plans
            WHERE workspace_id = $1 AND project_id = $2
            ORDER BY created_at DESC LIMIT 1
          )`, [workspaceId, projectId]),
    ]);

    return {
      stage,
      platform,
      messages: messages.rows.map(messageView),
      summaries: summaries.rows.map(summaryView),
      activeRun: runView(activeRun.rows[0]),
      artifacts: artifacts.rows.map(artifactView),
      usedMaterialIds: {
        inputIds: materials.rows.flatMap((row) => row.input_id ? [row.input_id] : []),
        referenceIds: materials.rows.flatMap((row) => row.reference_id ? [row.reference_id] : []),
      },
    };
  }

  async function appendMessage(workspaceId, projectId, input) {
    const result = await query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, role, content, action_run_id, stage, message_type, artifact_refs_json, metadata_json, created_at`, [
      workspaceId,
      projectId,
      input.actionRunId ?? null,
      input.role,
      input.content,
      input.stage,
      input.messageType ?? 'MESSAGE',
      JSON.stringify(input.artifactRefs ?? []),
      JSON.stringify(input.metadata ?? {}),
    ]);
    return messageView(result.rows[0]);
  }

  async function createArtifact(client, input) {
    const result = await client.query(`INSERT INTO project_artifacts
      (workspace_id, project_id, artifact_type, stage, platform, status, action_run_id, created_by_message_id, title, metadata_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [
      input.workspaceId,
      input.projectId,
      input.type,
      input.stage,
      input.platform ?? null,
      input.status ?? 'CANDIDATE',
      input.actionRunId ?? null,
      input.createdByMessageId ?? null,
      input.title ?? '',
      JSON.stringify(input.metadata ?? {}),
    ]);
    return result.rows[0];
  }

  async function acceptArtifact(workspaceId, projectId, artifactId) {
    return transaction(async (client) => {
      const result = await client.query(`UPDATE project_artifacts
        SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'CANDIDATE'
        RETURNING *`, [workspaceId, projectId, artifactId]);
      return result.rows[0] ?? null;
    });
  }

  async function upsertStageSummary(client, input) {
    const result = await client.query(`INSERT INTO project_stage_summaries
      (workspace_id, project_id, stage, platform, summary, through_message_id, version)
      SELECT $1, $2, $3, $4, $5, $6,
        COALESCE(MAX(version), 0) + 1
      FROM project_stage_summaries
      WHERE workspace_id = $1 AND project_id = $2 AND stage = $3
        AND platform IS NOT DISTINCT FROM $4::text
      RETURNING *`, [
      input.workspaceId,
      input.projectId,
      input.stage,
      input.platform ?? null,
      input.summary,
      input.throughMessageId ?? null,
    ]);
    return summaryView(result.rows[0]);
  }

  return { context, appendMessage, createArtifact, acceptArtifact, upsertStageSummary };
}

module.exports = { STAGES, messageView, summaryView, runView, artifactView, createProjectAgentStore };
