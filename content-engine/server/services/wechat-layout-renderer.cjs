const { businessError } = require('./business-errors.cjs');

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(['COVER', 'BODY', 'CARD', 'MAIN']);

const DEFAULT_WECHAT_LAYOUT_RULES = Object.freeze({
  schemaVersion: 1,
  canvas: { background: '#ffffff', textColor: '#1f2937', maxWidth: 677 },
  title: { fontSize: 30, fontWeight: 700, lineHeight: 1.35, color: '#111827' },
  body: { fontSize: 16, lineHeight: 1.9, paragraphSpacing: 18 },
  heading: { fontSize: 21, color: '#1d4ed8', borderColor: '#1d4ed8' },
  quote: { background: '#f5f7fa', borderColor: '#94a3b8' },
  image: { borderRadius: 0, spacing: 20, captionColor: '#64748b' },
  divider: { color: '#d1d5db', thickness: 1 },
});

const RULE_KEYS = Object.freeze({
  root: ['schemaVersion', 'canvas', 'title', 'body', 'heading', 'quote', 'image', 'divider'],
  canvas: ['background', 'textColor', 'maxWidth'],
  title: ['fontSize', 'fontWeight', 'lineHeight', 'color'],
  body: ['fontSize', 'lineHeight', 'paragraphSpacing'],
  heading: ['fontSize', 'color', 'borderColor'],
  quote: ['background', 'borderColor'],
  image: ['borderRadius', 'spacing', 'captionColor'],
  divider: ['color', 'thickness'],
});

function rulesError(message) {
  return businessError(400, 'LAYOUT_TEMPLATE_RULES_INVALID', message);
}

function assertExactKeys(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw rulesError(`${path} 必须是对象。`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) throw rulesError(`${path} 字段不符合模板规则白名单。`);
}

function color(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw rulesError(`${path} 必须是六位十六进制颜色。`);
  return value.toLowerCase();
}

function number(value, min, max, path, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw rulesError(`${path} 必须是数字。`);
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : Number(clamped.toFixed(2));
}

function normalizeWechatLayoutRules(input) {
  assertExactKeys(input, RULE_KEYS.root, 'rules');
  if (input.schemaVersion !== 1) throw rulesError('只支持 schemaVersion 1。');
  for (const section of RULE_KEYS.root.slice(1)) assertExactKeys(input[section], RULE_KEYS[section], section);
  return {
    schemaVersion: 1,
    canvas: {
      background: color(input.canvas.background, 'canvas.background'),
      textColor: color(input.canvas.textColor, 'canvas.textColor'),
      maxWidth: number(input.canvas.maxWidth, 320, 677, 'canvas.maxWidth', { integer: true }),
    },
    title: {
      fontSize: number(input.title.fontSize, 20, 48, 'title.fontSize', { integer: true }),
      fontWeight: number(input.title.fontWeight, 400, 900, 'title.fontWeight', { integer: true }),
      lineHeight: number(input.title.lineHeight, 1.1, 2, 'title.lineHeight'),
      color: color(input.title.color, 'title.color'),
    },
    body: {
      fontSize: number(input.body.fontSize, 12, 24, 'body.fontSize', { integer: true }),
      lineHeight: number(input.body.lineHeight, 1.2, 2.5, 'body.lineHeight'),
      paragraphSpacing: number(input.body.paragraphSpacing, 0, 40, 'body.paragraphSpacing', { integer: true }),
    },
    heading: {
      fontSize: number(input.heading.fontSize, 16, 36, 'heading.fontSize', { integer: true }),
      color: color(input.heading.color, 'heading.color'),
      borderColor: color(input.heading.borderColor, 'heading.borderColor'),
    },
    quote: {
      background: color(input.quote.background, 'quote.background'),
      borderColor: color(input.quote.borderColor, 'quote.borderColor'),
    },
    image: {
      borderRadius: number(input.image.borderRadius, 0, 24, 'image.borderRadius', { integer: true }),
      spacing: number(input.image.spacing, 0, 40, 'image.spacing', { integer: true }),
      captionColor: color(input.image.captionColor, 'image.captionColor'),
    },
    divider: {
      color: color(input.divider.color, 'divider.color'),
      thickness: number(input.divider.thickness, 1, 4, 'divider.thickness', { integer: true }),
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAssets(assets) {
  if (!Array.isArray(assets)) throw businessError(400, 'DRAFT_ASSET_INVALID', '草稿图片必须是数组。');
  if (assets.length > 12) throw businessError(400, 'DRAFT_IMAGE_LIMIT_EXCEEDED', '公众号最多允许 12 张图片。', { platform: 'WECHAT', limit: 12, actual: assets.length });
  const normalized = assets.map((item, index) => {
    const assetId = String(item?.assetId ?? '');
    const role = String(item?.role ?? '');
    const sortOrder = Number(item?.sortOrder ?? index);
    if (!UUID.test(assetId) || !ROLES.has(role) || !Number.isInteger(sortOrder) || sortOrder < 0) {
      throw businessError(400, 'DRAFT_ASSET_INVALID', '公众号草稿包含无效图片。');
    }
    return { assetId, role, sortOrder };
  }).sort((left, right) => left.sortOrder - right.sortOrder || left.assetId.localeCompare(right.assetId));
  if (new Set(normalized.map(({ assetId }) => assetId)).size !== normalized.length) throw businessError(400, 'DRAFT_ASSET_INVALID', '公众号草稿不能重复使用同一张图片。');
  return normalized;
}

function bodyBlocks(body, rules) {
  const paragraphStyle = `margin:0 0 ${rules.body.paragraphSpacing}px;font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;`;
  return String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).map((block) => {
    if (/^(?:---|\*\*\*)$/.test(block)) return `<hr style="border:0;border-top:${rules.divider.thickness}px solid ${rules.divider.color};margin:${rules.body.paragraphSpacing}px 0;">`;
    const heading = /^#{1,3}\s+([\s\S]+)$/.exec(block);
    if (heading) return `<h2 style="margin:${rules.body.paragraphSpacing}px 0 ${Math.max(8, Math.round(rules.body.paragraphSpacing / 2))}px;padding-left:10px;border-left:3px solid ${rules.heading.borderColor};font-size:${rules.heading.fontSize}px;line-height:1.45;color:${rules.heading.color};font-weight:700;letter-spacing:0;word-break:break-word;">${escapeHtml(heading[1].trim())}</h2>`;
    if (block.split('\n').every((line) => /^>\s?/.test(line))) {
      const value = block.split('\n').map((line) => line.replace(/^>\s?/, '')).join('\n');
      return `<blockquote style="margin:${rules.body.paragraphSpacing}px 0;padding:12px 16px;border-left:4px solid ${rules.quote.borderColor};background:${rules.quote.background};font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;">${escapeHtml(value).replace(/\n/g, '<br>')}</blockquote>`;
    }
    const lines = block.split('\n');
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul style="margin:0 0 ${rules.body.paragraphSpacing}px;padding-left:1.5em;font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;">${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p style="${paragraphStyle}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
  });
}

function imageHtml(asset, rules) {
  return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;"><img src="/api/v1/assets/${asset.assetId}/content" alt="" style="display:block;width:100%;height:auto;border-radius:${rules.image.borderRadius}px;"></figure>`;
}

function interleaveContent(blocks, assets, rules) {
  const coverIndex = assets.findIndex(({ role }) => role === 'COVER' || role === 'MAIN');
  const cover = coverIndex >= 0 ? assets[coverIndex] : assets[0];
  const remaining = assets.filter((_, index) => index !== (coverIndex >= 0 ? coverIndex : 0));
  const output = [];
  if (cover) output.push(imageHtml(cover, rules));
  if (!blocks.length) return output.concat(remaining.map((item) => imageHtml(item, rules)));
  const interval = remaining.length ? Math.max(1, Math.ceil(blocks.length / remaining.length)) : Number.POSITIVE_INFINITY;
  let imageIndex = 0;
  blocks.forEach((block, index) => {
    output.push(block);
    if ((index + 1) % interval === 0 && imageIndex < remaining.length) output.push(imageHtml(remaining[imageIndex++], rules));
  });
  while (imageIndex < remaining.length) output.push(imageHtml(remaining[imageIndex++], rules));
  return output;
}

function renderWechatDraft({ title, body, assets = [], templateRules }) {
  const rules = normalizeWechatLayoutRules(templateRules);
  const normalizedAssets = normalizeAssets(assets);
  const checks = normalizedAssets.length ? [] : [{ level: 'WARNING', code: 'DRAFT_IMAGE_MISSING', message: '公众号草稿还没有配置图片。' }];
  const content = interleaveContent(bodyBlocks(body, rules), normalizedAssets, rules).join('');
  const html = `<article data-layout-schema="1" style="box-sizing:border-box;width:100%;max-width:${rules.canvas.maxWidth}px;margin:0 auto;padding:24px 18px;background:${rules.canvas.background};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;"><h1 style="margin:0 0 22px;font-size:${rules.title.fontSize}px;font-weight:${rules.title.fontWeight};line-height:${rules.title.lineHeight};color:${rules.title.color};letter-spacing:0;word-break:break-word;">${escapeHtml(title)}</h1>${content}</article>`;
  return { html, checks };
}

module.exports = { DEFAULT_WECHAT_LAYOUT_RULES, normalizeWechatLayoutRules, renderWechatDraft };
