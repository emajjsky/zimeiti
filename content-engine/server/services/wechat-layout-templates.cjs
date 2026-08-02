const { createHash } = require('node:crypto');
const cheerio = require('cheerio');
const { businessError } = require('./business-errors.cjs');
const { fetchPublicPage, assertWechatArticleUrl } = require('./public-web.cjs');
const { normalizeWechatLayoutRules } = require('./wechat-layout-renderer.cjs');

const WECHAT_TEMPLATE_ANALYSIS_SCOPE = 'WECHAT_TEMPLATE_ANALYSIS';
const WECHAT_TEMPLATE_ANALYSIS_PROMPT_VERSION = 'wechat-layout-analysis:1';

function stripCodeFence(value) {
  return String(value ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseStyle(style) {
  return String(style ?? '').split(';').map((entry) => entry.split(':', 2).map((part) => part.trim().toLowerCase())).filter(([key, value]) => key && value);
}

function distinct(values, limit = 12) {
  return [...new Set(values.filter(Boolean))].sort().slice(0, limit);
}

function extractWechatLayoutSignals(html) {
  const $ = cheerio.load(html, { xmlMode: false, decodeEntities: true });
  const root = $('#js_content').first();
  if (!root.length) throw businessError(400, 'LAYOUT_TEMPLATE_SOURCE_INVALID', '链接中没有找到公众号文章正文结构。');
  const colors = [];
  const backgrounds = [];
  const fontSizes = [];
  const lineHeights = [];
  const spacings = [];
  root.find('[style]').addBack('[style]').slice(0, 240).each((_, element) => {
    for (const [key, value] of parseStyle($(element).attr('style'))) {
      if ((key === 'color' || key === 'border-color') && /^#[0-9a-f]{6}$/i.test(value)) colors.push(value.toLowerCase());
      if (key === 'background' || key === 'background-color') {
        const match = /#[0-9a-f]{6}/i.exec(value);
        if (match) backgrounds.push(match[0].toLowerCase());
      }
      if (key === 'font-size' && /^\d+(?:\.\d+)?px$/.test(value)) fontSizes.push(value);
      if (key === 'line-height' && /^\d+(?:\.\d+)?(?:px)?$/.test(value)) lineHeights.push(value);
      if (/^margin(?:-bottom|-top)?$/.test(key) && /^\d+(?:\.\d+)?px$/.test(value)) spacings.push(value);
    }
  });
  return {
    headingCount: root.find('h1,h2,h3,h4').length,
    paragraphCount: root.find('p').length,
    quoteCount: root.find('blockquote').length,
    dividerCount: root.find('hr').length,
    figureCount: root.find('figure').length,
    imageCount: root.find('img').length,
    sectionCount: root.find('section').length,
    inlineStyleCount: root.find('[style]').length,
    colors: distinct(colors),
    backgrounds: distinct(backgrounds),
    fontSizes: distinct(fontSizes),
    lineHeights: distinct(lineHeights),
    spacings: distinct(spacings),
  };
}

function templateAnalysisPrompt(signals) {
  return {
    system: [
      '你是公众号排版规则分析器。你只根据匿名结构统计和样式采样生成规则，不接触、不复述来源文章内容。',
      '只返回 JSON 对象。禁止返回 HTML、CSS、选择器、脚本、图片地址或额外字段。',
      '所有颜色必须是六位十六进制；数值超出合理范围时选择接近的安全值。',
    ].join('\n'),
    message: JSON.stringify({
      task: '把以下匿名排版信号归纳为公众号模板规则',
      signals,
      outputShape: {
        schemaVersion: 1,
        canvas: { background: '#ffffff', textColor: '#1f2937', maxWidth: 677 },
        title: { fontSize: 30, fontWeight: 700, lineHeight: 1.35, color: '#111827' },
        body: { fontSize: 16, lineHeight: 1.9, paragraphSpacing: 18 },
        heading: { fontSize: 21, color: '#1d4ed8', borderColor: '#1d4ed8' },
        quote: { background: '#f5f7fa', borderColor: '#94a3b8' },
        image: { borderRadius: 0, spacing: 20, captionColor: '#64748b' },
        divider: { color: '#d1d5db', thickness: 1 },
      },
    }),
  };
}

async function analyzeWechatTemplateSource({ url, confirmedRights, route, runTextTask, fetchPublicPage: fetchPage = fetchPublicPage }) {
  if (confirmedRights !== true) throw businessError(400, 'LAYOUT_TEMPLATE_RIGHTS_REQUIRED', '导入前必须确认你有权使用该公众号文章的排版作为参考。');
  const requestedUrl = assertWechatArticleUrl(url);
  if (!route || route.scope !== undefined && route.scope !== WECHAT_TEMPLATE_ANALYSIS_SCOPE) throw businessError(409, 'TASK_POLICY_REQUIRED', '请先为公众号模板分析配置任务策略。', { scope: WECHAT_TEMPLATE_ANALYSIS_SCOPE });
  if (typeof runTextTask !== 'function') throw new TypeError('公众号模板分析需要 runTextTask。');
  let page;
  try {
    page = await fetchPage(requestedUrl.toString());
  } catch (error) {
    if (error?.code === 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE') throw error;
    const unreadable = businessError(422, 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE', '公众号文章链接暂时无法读取，请确认链接公开且仍然有效。');
    unreadable.cause = error;
    throw unreadable;
  }
  const finalUrl = assertWechatArticleUrl(page.url.toString());
  const signals = extractWechatLayoutSignals(page.html);
  const prompt = templateAnalysisPrompt(signals);
  const result = await runTextTask({ route, ...prompt, maxTokens: 2_000, temperature: 0.1 });
  let rawRules;
  try { rawRules = JSON.parse(stripCodeFence(result.content)); }
  catch { throw businessError(400, 'LAYOUT_TEMPLATE_RULES_INVALID', '模型返回的模板规则不是有效 JSON。'); }
  const rules = normalizeWechatLayoutRules(rawRules);
  const sourceFingerprint = createHash('sha256').update(JSON.stringify({ url: finalUrl.toString(), signals })).digest('hex');
  return {
    rules,
    sourceUrl: finalUrl.toString(),
    sourceFingerprint,
    promptVersion: WECHAT_TEMPLATE_ANALYSIS_PROMPT_VERSION,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  };
}

function versionView(row) {
  return {
    id: row.id,
    versionNumber: Number(row.version_number),
    rules: row.rules_json,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? null,
    sourceFingerprint: row.source_fingerprint ?? null,
    promptVersion: row.prompt_version ?? null,
    generationRunId: row.generation_run_id ?? null,
    createdAt: row.created_at,
  };
}

function templateView(template, version) {
  return {
    id: template.id,
    workspaceId: template.workspace_id,
    name: template.name,
    kind: template.kind,
    status: template.status,
    currentVersionId: template.current_version_id,
    currentVersionNumber: Number(version.version_number),
    rules: version.rules_json,
    sourceUrl: version.source_url ?? null,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
  };
}

function joinedTemplateView(row) {
  return templateView(row, {
    id: row.version_id,
    version_number: row.version_number,
    rules_json: row.rules_json,
    source_type: row.source_type,
    source_url: row.source_url,
    source_fingerprint: row.source_fingerprint,
    prompt_version: row.prompt_version,
    generation_run_id: row.generation_run_id,
    created_at: row.version_created_at,
  });
}

function databaseError(error) {
  if (error?.code === '23505') return businessError(409, 'LAYOUT_TEMPLATE_NAME_CONFLICT', '当前工作空间已经有同名模板。');
  return error;
}

function createWechatLayoutTemplateStore({ query, transaction }) {
  if (typeof query !== 'function' || typeof transaction !== 'function') throw new TypeError('模板 Store 需要 query 和 transaction。');

  async function list(workspaceId) {
    const result = await query(`SELECT template.*, version.id AS version_id, version.version_number, version.rules_json,
      version.source_type, version.source_url, version.source_fingerprint, version.prompt_version,
      version.generation_run_id, version.created_at AS version_created_at
      FROM wechat_layout_templates template
      JOIN wechat_layout_template_versions version
        ON version.workspace_id = template.workspace_id AND version.id = template.current_version_id
      WHERE template.workspace_id = $1 AND template.status = 'ACTIVE'
      ORDER BY CASE template.kind WHEN 'SYSTEM' THEN 0 ELSE 1 END, template.updated_at DESC, template.id`, [workspaceId]);
    return result.rows.map(joinedTemplateView);
  }

  async function get(workspaceId, templateId, client = { query }) {
    const result = await client.query(`SELECT template.*, version.id AS version_id, version.version_number, version.rules_json,
      version.source_type, version.source_url, version.source_fingerprint, version.prompt_version,
      version.generation_run_id, version.created_at AS version_created_at
      FROM wechat_layout_templates template
      JOIN wechat_layout_template_versions version
        ON version.workspace_id = template.workspace_id AND version.id = template.current_version_id
      WHERE template.workspace_id = $1 AND template.id = $2 AND template.status = 'ACTIVE'`, [workspaceId, templateId]);
    if (!result.rows.length) throw businessError(404, 'LAYOUT_TEMPLATE_NOT_FOUND', '没有找到该公众号排版模板。');
    return joinedTemplateView(result.rows[0]);
  }

  async function create(workspaceId, name, input, transactionClient = null) {
    const rules = normalizeWechatLayoutRules(input.rules);
    const normalizedName = String(name ?? '').trim();
    if (!normalizedName || normalizedName.length > 80) throw businessError(400, 'LAYOUT_TEMPLATE_NAME_INVALID', '模板名称长度必须为 1 到 80 个字符。');
    const persist = async (client) => {
      const insertedTemplate = await client.query(`INSERT INTO wechat_layout_templates
        (workspace_id, name, kind, status, created_by)
        VALUES ($1, $2, 'CUSTOM', 'ACTIVE', $3)
        RETURNING *`, [workspaceId, normalizedName, input.userId ?? null]);
      const template = insertedTemplate.rows[0];
      const insertedVersion = await client.query(`INSERT INTO wechat_layout_template_versions
        (workspace_id, template_id, version_number, source_type, rules_json, source_url,
          source_fingerprint, prompt_version, generation_run_id, created_by)
        VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`, [workspaceId, template.id, input.sourceType ?? 'MANUAL', JSON.stringify(rules), input.sourceUrl ?? null, input.sourceFingerprint ?? null, input.promptVersion ?? null, input.generationRunId ?? null, input.userId ?? null]);
      const version = insertedVersion.rows[0];
      const updated = await client.query(`UPDATE wechat_layout_templates
        SET current_version_id = $3, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, template.id, version.id]);
      return templateView(updated.rows[0], version);
    };
    try {
      return transactionClient ? await persist(transactionClient) : await transaction(persist);
    } catch (error) { throw databaseError(error); }
  }

  async function update(workspaceId, templateId, input) {
    const rules = normalizeWechatLayoutRules(input.rules);
    const normalizedName = String(input.name ?? '').trim();
    if (!normalizedName || normalizedName.length > 80) throw businessError(400, 'LAYOUT_TEMPLATE_NAME_INVALID', '模板名称长度必须为 1 到 80 个字符。');
    try {
      return await transaction(async (client) => {
        const locked = await client.query(`SELECT * FROM wechat_layout_templates
          WHERE workspace_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`, [workspaceId, templateId]);
        if (!locked.rows.length) throw businessError(404, 'LAYOUT_TEMPLATE_NOT_FOUND', '没有找到该公众号排版模板。');
        if (locked.rows[0].kind === 'SYSTEM') throw businessError(409, 'LAYOUT_TEMPLATE_SYSTEM_PROTECTED', '系统模板不能修改，请先复制为自定义模板。');
        const next = await client.query(`SELECT COALESCE(max(version_number), 0) + 1 AS next_version
          FROM wechat_layout_template_versions WHERE workspace_id = $1 AND template_id = $2`, [workspaceId, templateId]);
        const inserted = await client.query(`INSERT INTO wechat_layout_template_versions
          (workspace_id, template_id, version_number, source_type, rules_json, source_url,
            source_fingerprint, prompt_version, generation_run_id, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`, [workspaceId, templateId, Number(next.rows[0].next_version), input.sourceType ?? 'MANUAL', JSON.stringify(rules), input.sourceUrl ?? null, input.sourceFingerprint ?? null, input.promptVersion ?? null, input.generationRunId ?? null, input.userId ?? null]);
        const version = inserted.rows[0];
        const updated = await client.query(`UPDATE wechat_layout_templates
          SET name = $3, current_version_id = $4, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, templateId, normalizedName, version.id]);
        return templateView(updated.rows[0], version);
      });
    } catch (error) { throw databaseError(error); }
  }

  async function duplicate(workspaceId, templateId, name, userId) {
    return transaction(async (client) => {
      const source = await get(workspaceId, templateId, client);
      return create(workspaceId, name, { rules: source.rules, sourceType: 'MANUAL', userId }, client);
    });
  }

  async function assertNotReferenced(client, workspaceId, templateId) {
    const references = await client.query(`SELECT
      (SELECT count(*) FROM content_drafts draft
        JOIN wechat_layout_template_versions version ON version.workspace_id = draft.workspace_id AND version.id = draft.layout_template_version_id
        WHERE version.workspace_id = $1 AND version.template_id = $2) +
      (SELECT count(*) FROM content_draft_versions draft_version
        JOIN wechat_layout_template_versions version ON version.workspace_id = draft_version.workspace_id AND version.id = draft_version.layout_template_version_id
        WHERE version.workspace_id = $1 AND version.template_id = $2) AS count`, [workspaceId, templateId]);
    if (Number(references.rows[0]?.count ?? 0) > 0) throw businessError(409, 'LAYOUT_TEMPLATE_IN_USE', '模板仍被草稿或历史版本引用，不能归档或删除。');
  }

  async function archive(workspaceId, templateId) {
    return transaction(async (client) => {
      const locked = await client.query(`SELECT * FROM wechat_layout_templates
        WHERE workspace_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`, [workspaceId, templateId]);
      if (!locked.rows.length) throw businessError(404, 'LAYOUT_TEMPLATE_NOT_FOUND', '没有找到该公众号排版模板。');
      if (locked.rows[0].kind === 'SYSTEM') throw businessError(409, 'LAYOUT_TEMPLATE_SYSTEM_PROTECTED', '系统模板不能归档。');
      await assertNotReferenced(client, workspaceId, templateId);
      await client.query(`UPDATE wechat_layout_templates SET status = 'ARCHIVED', updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, templateId]);
    });
  }

  async function remove(workspaceId, templateId) {
    return transaction(async (client) => {
      const locked = await client.query(`SELECT * FROM wechat_layout_templates
        WHERE workspace_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`, [workspaceId, templateId]);
      if (!locked.rows.length) throw businessError(404, 'LAYOUT_TEMPLATE_NOT_FOUND', '没有找到该公众号排版模板。');
      if (locked.rows[0].kind === 'SYSTEM') throw businessError(409, 'LAYOUT_TEMPLATE_SYSTEM_PROTECTED', '系统模板不能删除。');
      await assertNotReferenced(client, workspaceId, templateId);
      await client.query('DELETE FROM wechat_layout_templates WHERE workspace_id = $1 AND id = $2', [workspaceId, templateId]);
    });
  }

  return { list, get, create, update, duplicate, archive, remove };
}

module.exports = {
  WECHAT_TEMPLATE_ANALYSIS_SCOPE,
  WECHAT_TEMPLATE_ANALYSIS_PROMPT_VERSION,
  analyzeWechatTemplateSource,
  createWechatLayoutTemplateStore,
  extractWechatLayoutSignals,
};
