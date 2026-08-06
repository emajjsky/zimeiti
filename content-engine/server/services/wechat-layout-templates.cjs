const { createHash } = require('node:crypto');
const cheerio = require('cheerio');
const { businessError } = require('./business-errors.cjs');
const { fetchPublicPage, assertWechatArticleUrl } = require('./public-web.cjs');
const { DEFAULT_WECHAT_LAYOUT_RULES, normalizeWechatLayoutRules } = require('./wechat-layout-renderer.cjs');

const WECHAT_TEMPLATE_ANALYSIS_SCOPE = 'WECHAT_TEMPLATE_ANALYSIS';
const WECHAT_TEMPLATE_ANALYSIS_PROMPT_VERSION = 'wechat-layout-analysis:1';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IMPORT_LAYOUT_ENUMS = Object.freeze({
  titleVariant: ['plain', 'bar', 'card', 'label', 'split', 'poster', 'news'],
  headingVariant: ['left-bar', 'pill', 'underline', 'numbered', 'band', 'stamp', 'shadow-card', 'center-underline'],
  imageVariant: ['plain', 'framed', 'shadow', 'bleed', 'cutout', 'poster'],
  quoteVariant: ['bar', 'card', 'bubble', 'outline'],
  dividerVariant: ['line', 'dots', 'label'],
  leadVariant: ['none', 'card', 'stripe', 'kicker'],
  tocVariant: ['none', 'bullets', 'card', 'index'],
  listVariant: ['plain', 'bold', 'spaced', 'check'],
  linkVariant: ['plain', 'accent', 'pill'],
  tagVariant: ['none', 'chips', 'rail', 'mono'],
  metaVariant: ['none', 'muted', 'chips'],
  paragraphVariant: ['plain', 'indent', 'rail', 'card', 'report', 'newspaper', 'case-card'],
  inlineVariant: ['plain', 'accent', 'dual', 'marker', 'mono'],
});
const IMPORT_LAYOUT_ALIASES = Object.freeze({
  titleVariant: { minimal: 'plain', underline: 'bar', bordered: 'card', badge: 'label', splitline: 'split', cover: 'poster', media: 'news', article: 'news' },
  headingVariant: { bar: 'left-bar', line: 'underline', number: 'numbered', numberedList: 'numbered', banner: 'band', seal: 'stamp', card: 'shadow-card', shadow: 'shadow-card', sectionCard: 'shadow-card', centered: 'center-underline' },
  imageVariant: { frame: 'framed', border: 'framed', card: 'framed', dropShadow: 'shadow', fullBleed: 'bleed', full: 'bleed', mask: 'cutout' },
  quoteVariant: { line: 'bar', block: 'card', callout: 'card', chat: 'bubble', bordered: 'outline' },
  dividerVariant: { solid: 'line', dotted: 'dots', dot: 'dots', text: 'label' },
  leadVariant: { plain: 'none', callout: 'card', line: 'stripe', dropcap: 'kicker', dropCap: 'kicker' },
  tocVariant: { list: 'bullets', outline: 'card', catalog: 'card', directory: 'card', numbered: 'index' },
  listVariant: { bullet: 'plain', emphasis: 'bold', roomy: 'spaced', checked: 'check' },
  linkVariant: { underline: 'plain', blue: 'accent', badge: 'pill' },
  tagVariant: { chip: 'chips', hashtags: 'mono', hash: 'mono', side: 'rail' },
  metaVariant: { line: 'muted', badges: 'chips' },
  paragraphVariant: { body: 'plain', essay: 'indent', indented: 'indent', sidebar: 'rail', rail: 'rail', boxed: 'card', blocks: 'card', report: 'report', digest: 'newspaper', newspaper: 'newspaper', case: 'case-card', cases: 'case-card', caseCard: 'case-card', numberedBox: 'case-card', numberedCard: 'case-card' },
  inlineVariant: { color: 'accent', highlight: 'marker', marker: 'marker', bicolor: 'dual', twoTone: 'dual', code: 'dual', monochrome: 'mono' },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function safeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeEnum(section, key, fallback) {
  const raw = section?.[key];
  if (typeof raw !== 'string') return fallback;
  if (IMPORT_LAYOUT_ENUMS[key].includes(raw)) return raw;
  return IMPORT_LAYOUT_ALIASES[key][raw] ?? fallback;
}

function coerceImportedWechatLayoutRules(input) {
  const source = isPlainObject(input?.rules) ? input.rules : input;
  if (!isPlainObject(source)) throw businessError(400, 'LAYOUT_TEMPLATE_RULES_INVALID', '模型返回的模板规则不是有效对象。');
  if (!['canvas', 'title', 'body', 'heading', 'quote', 'image', 'divider', 'layout'].some((key) => isPlainObject(source[key]))) {
    throw businessError(400, 'LAYOUT_TEMPLATE_RULES_INVALID', '模型返回的模板规则缺少有效分区。');
  }
  const base = DEFAULT_WECHAT_LAYOUT_RULES;
  const canvas = isPlainObject(source.canvas) ? source.canvas : {};
  const title = isPlainObject(source.title) ? source.title : {};
  const body = isPlainObject(source.body) ? source.body : {};
  const heading = isPlainObject(source.heading) ? source.heading : {};
  const quote = isPlainObject(source.quote) ? source.quote : {};
  const image = isPlainObject(source.image) ? source.image : {};
  const divider = isPlainObject(source.divider) ? source.divider : {};
  const layout = isPlainObject(source.layout) ? source.layout : {};
  return normalizeWechatLayoutRules({
    schemaVersion: 1,
    canvas: {
      background: safeColor(canvas.background, base.canvas.background),
      textColor: safeColor(canvas.textColor, base.canvas.textColor),
      maxWidth: safeNumber(canvas.maxWidth, base.canvas.maxWidth),
    },
    title: {
      fontSize: safeNumber(title.fontSize, base.title.fontSize),
      fontWeight: safeNumber(title.fontWeight, base.title.fontWeight),
      lineHeight: safeNumber(title.lineHeight, base.title.lineHeight),
      color: safeColor(title.color, base.title.color),
    },
    body: {
      fontSize: safeNumber(body.fontSize, base.body.fontSize),
      lineHeight: safeNumber(body.lineHeight, base.body.lineHeight),
      paragraphSpacing: safeNumber(body.paragraphSpacing, base.body.paragraphSpacing),
    },
    heading: {
      fontSize: safeNumber(heading.fontSize, base.heading.fontSize),
      color: safeColor(heading.color, base.heading.color),
      borderColor: safeColor(heading.borderColor, base.heading.borderColor),
    },
    quote: {
      background: safeColor(quote.background, base.quote.background),
      borderColor: safeColor(quote.borderColor, base.quote.borderColor),
    },
    image: {
      borderRadius: safeNumber(image.borderRadius, base.image.borderRadius),
      spacing: safeNumber(image.spacing, base.image.spacing),
      captionColor: safeColor(image.captionColor, base.image.captionColor),
    },
    divider: {
      color: safeColor(divider.color, base.divider.color),
      thickness: safeNumber(divider.thickness, base.divider.thickness),
    },
    layout: {
      titleVariant: safeEnum(layout, 'titleVariant', base.layout.titleVariant),
      headingVariant: safeEnum(layout, 'headingVariant', base.layout.headingVariant),
      imageVariant: safeEnum(layout, 'imageVariant', base.layout.imageVariant),
      quoteVariant: safeEnum(layout, 'quoteVariant', base.layout.quoteVariant),
      dividerVariant: safeEnum(layout, 'dividerVariant', base.layout.dividerVariant),
      leadVariant: safeEnum(layout, 'leadVariant', base.layout.leadVariant),
      tocVariant: safeEnum(layout, 'tocVariant', base.layout.tocVariant),
      listVariant: safeEnum(layout, 'listVariant', base.layout.listVariant),
      linkVariant: safeEnum(layout, 'linkVariant', base.layout.linkVariant),
      tagVariant: safeEnum(layout, 'tagVariant', base.layout.tagVariant),
      metaVariant: safeEnum(layout, 'metaVariant', base.layout.metaVariant),
      paragraphVariant: safeEnum(layout, 'paragraphVariant', base.layout.paragraphVariant),
      inlineVariant: safeEnum(layout, 'inlineVariant', base.layout.inlineVariant),
    },
  });
}

function refineImportedWechatLayoutRules(rules, signals) {
  const layout = { ...rules.layout };
  const caseAccent = signals.colors.find((value) => {
    const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (!rgb) return false;
    const red = Number.parseInt(rgb[1], 16);
    const green = Number.parseInt(rgb[2], 16);
    const blue = Number.parseInt(rgb[3], 16);
    return blue > red && blue >= green && blue >= 120;
  });
  if (signals.shadowCount >= 2 && layout.headingVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.headingVariant) layout.headingVariant = 'shadow-card';
  if (signals.centeredTextCount >= 2 && layout.headingVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.headingVariant) layout.headingVariant = 'center-underline';
  if (signals.linkCount >= 2 && layout.linkVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.linkVariant) layout.linkVariant = 'accent';
  if (signals.listItemCount >= 4 && layout.listVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.listVariant) layout.listVariant = 'bold';
  if (signals.listItemCount >= 4 && signals.headingCount >= 3 && layout.tocVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.tocVariant) layout.tocVariant = 'card';
  if (signals.headingCount >= 3 && layout.tagVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.tagVariant) layout.tagVariant = 'chips';
  if (layout.inlineVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.inlineVariant) {
    if (signals.redAccentCount >= 1 && signals.linkCount >= 1) layout.inlineVariant = 'dual';
    else if (signals.redAccentCount >= 1) layout.inlineVariant = 'accent';
    else if (signals.backgrounds.length >= 2 && signals.radiusCount >= 2) layout.inlineVariant = 'marker';
  }
  if (layout.paragraphVariant === DEFAULT_WECHAT_LAYOUT_RULES.layout.paragraphVariant) {
    if (signals.caseCardCount >= 3) layout.paragraphVariant = 'case-card';
    else if (signals.shadowCount >= 2 || signals.borderLeftCount >= 2) layout.paragraphVariant = 'rail';
    else if (signals.radiusCount >= 3 && signals.backgrounds.length >= 2) layout.paragraphVariant = 'card';
    else if (signals.centeredTextCount >= 2) layout.paragraphVariant = 'newspaper';
    else if (signals.listItemCount >= 4) layout.paragraphVariant = 'report';
    else if (signals.paragraphCount >= 6) layout.paragraphVariant = 'indent';
  }
  if (signals.caseCardCount >= 3 && caseAccent) {
    return normalizeWechatLayoutRules({
      ...rules,
      heading: { ...rules.heading, color: caseAccent, borderColor: caseAccent },
      divider: { ...rules.divider, color: caseAccent },
      layout,
    });
  }
  if (signals.redAccentCount >= 1 && layout.headingVariant === 'shadow-card') {
    return normalizeWechatLayoutRules({
      ...rules,
      heading: { ...rules.heading, borderColor: '#ff4d2e' },
      layout,
    });
  }
  return normalizeWechatLayoutRules({ ...rules, layout });
}

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
  let shadowCount = 0;
  let radiusCount = 0;
  let borderLeftCount = 0;
  let centeredTextCount = 0;
  let redAccentCount = 0;
  let caseCardCount = 0;
  root.find('[style]').addBack('[style]').slice(0, 240).each((_, element) => {
    for (const [key, value] of parseStyle($(element).attr('style'))) {
      if ((key === 'color' || key === 'border-color') && /^#[0-9a-f]{6}$/i.test(value)) colors.push(value.toLowerCase());
      if (key.startsWith('border')) {
        const match = /#[0-9a-f]{6}/i.exec(value);
        if (match) colors.push(match[0].toLowerCase());
      }
      if (key === 'background' || key === 'background-color') {
        const match = /#[0-9a-f]{6}/i.exec(value);
        if (match) backgrounds.push(match[0].toLowerCase());
      }
      if (key === 'box-shadow' && value !== 'none') shadowCount += 1;
      if (key === 'border-radius' && !/^0(?:px)?$/.test(value)) radiusCount += 1;
      if (key === 'border-left' || key === 'border-left-color' || key === 'border-left-style') borderLeftCount += 1;
      if (key === 'text-align' && value === 'center') centeredTextCount += 1;
      if (/#[ef][0-9a-f]{5}|#ff[0-9a-f]{4}/i.test(value)) redAccentCount += 1;
      if (key === 'font-size' && /^\d+(?:\.\d+)?px$/.test(value)) fontSizes.push(value);
      if (key === 'line-height' && /^\d+(?:\.\d+)?(?:px)?$/.test(value)) lineHeights.push(value);
      if (/^margin(?:-bottom|-top)?$/.test(key) && /^\d+(?:\.\d+)?px$/.test(value)) spacings.push(value);
    }
  });
  root.find('section,p,div').slice(0, 320).each((_, element) => {
    const node = $(element);
    const style = parseStyle(node.attr('style'));
    const styleText = style.map(([key, value]) => `${key}:${value}`).join(';');
    const text = node.text().replace(/\s+/g, '').slice(0, 120);
    const hasLargeNumber = /^(?:[1-9]|1[0-9]|2[0-9])/.test(text) || node.find('*').filter((__, child) => {
      const childText = $(child).text().replace(/\s+/g, '');
      const childStyle = parseStyle($(child).attr('style'));
      const fontSize = childStyle.find(([key]) => key === 'font-size')?.[1] ?? '';
      return /^(?:[1-9]|1[0-9]|2[0-9])$/.test(childText) && /(?:[3-9]\d|[1-9]\d{2,})px/.test(fontSize);
    }).length > 0;
    const hasRoundedBorder = /border[^;]*solid/.test(styleText) && /border-radius:(?:[6-9]|[1-9]\d)px/.test(styleText);
    const hasCaseLine = /border-top|border-bottom|border-color|background/.test(styleText);
    if (hasLargeNumber && hasRoundedBorder && hasCaseLine) caseCardCount += 1;
  });
  return {
    headingCount: root.find('h1,h2,h3,h4').length,
    paragraphCount: root.find('p').length,
    quoteCount: root.find('blockquote').length,
    dividerCount: root.find('hr').length,
    figureCount: root.find('figure').length,
    imageCount: root.find('img').length,
    sectionCount: root.find('section').length,
    listItemCount: root.find('li').length,
    linkCount: root.find('a[href]').length,
    inlineStyleCount: root.find('[style]').length,
    shadowCount,
    radiusCount,
    borderLeftCount,
    centeredTextCount,
    redAccentCount,
    caseCardCount,
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
      'layout.titleVariant can only be plain/bar/card/label/split/poster/news.',
      'layout.headingVariant can only be left-bar/pill/underline/numbered/band/stamp/shadow-card/center-underline.',
      'layout.imageVariant can only be plain/framed/shadow/bleed/cutout/poster.',
      'layout.quoteVariant can only be bar/card/bubble/outline.',
      'layout.dividerVariant can only be line/dots/label.',
      'layout.leadVariant can only be none/card/stripe/kicker.',
      'layout.tocVariant can only be none/bullets/card/index. Use card or index when the source has a visible table of contents.',
      'layout.listVariant can only be plain/bold/spaced/check. Use bold when list labels are visually emphasized.',
      'layout.linkVariant can only be plain/accent/pill. Use accent when links are blue or underlined as a visible feature.',
      'layout.tagVariant can only be none/chips/rail/mono. Use chips or mono when the layout shows category/tag labels.',
      'layout.metaVariant can only be none/muted/chips.',
      'layout.paragraphVariant can only be plain/indent/rail/card/report/newspaper/case-card. Use case-card when the source repeats large numbered rounded boxes for cases/examples.',
      'layout.inlineVariant can only be plain/accent/dual/marker/mono. Use dual when the source mixes red emphasis with blue links or code-like labels.',
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
        layout: {
          titleVariant: 'plain',
          headingVariant: 'left-bar',
          imageVariant: 'plain',
          quoteVariant: 'bar',
          dividerVariant: 'line',
          leadVariant: 'none',
          tocVariant: 'none',
          listVariant: 'plain',
          linkVariant: 'plain',
          tagVariant: 'none',
          metaVariant: 'none',
          paragraphVariant: 'plain',
          inlineVariant: 'plain',
        },
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
  const rules = refineImportedWechatLayoutRules(coerceImportedWechatLayoutRules(rawRules), signals);
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
