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
});

const RULE_KEYS = Object.freeze({
  root: ['schemaVersion', 'canvas', 'title', 'body', 'heading', 'quote', 'image', 'divider', 'layout'],
  canvas: ['background', 'textColor', 'maxWidth'],
  title: ['fontSize', 'fontWeight', 'lineHeight', 'color'],
  body: ['fontSize', 'lineHeight', 'paragraphSpacing'],
  heading: ['fontSize', 'color', 'borderColor'],
  quote: ['background', 'borderColor'],
  image: ['borderRadius', 'spacing', 'captionColor'],
  divider: ['color', 'thickness'],
  layout: ['titleVariant', 'headingVariant', 'imageVariant', 'quoteVariant', 'dividerVariant', 'leadVariant', 'tocVariant', 'listVariant', 'linkVariant', 'tagVariant', 'metaVariant', 'paragraphVariant', 'inlineVariant'],
});

const RULE_ENUMS = Object.freeze({
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

function rulesError(message) {
  return businessError(400, 'LAYOUT_TEMPLATE_RULES_INVALID', message);
}

function assertAllowedKeys(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw rulesError(`${path} 必须是对象。`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.includes(key));
  if (unknown.length) throw rulesError(`${path} 字段不符合模板规则白名单。`);
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

function enumValue(value, allowed, fallback, path) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw rulesError(`${path} 必须是允许的模板枚举值。`);
  return value;
}

function section(input, name) {
  const value = { ...DEFAULT_WECHAT_LAYOUT_RULES[name], ...(input[name] ?? {}) };
  assertAllowedKeys(value, RULE_KEYS[name], name);
  return value;
}

function normalizeWechatLayoutRules(input) {
  assertAllowedKeys(input, RULE_KEYS.root, 'rules');
  if (input.schemaVersion !== 1) throw rulesError('只支持 schemaVersion 1。');
  const canvas = section(input, 'canvas');
  const title = section(input, 'title');
  const body = section(input, 'body');
  const heading = section(input, 'heading');
  const quote = section(input, 'quote');
  const image = section(input, 'image');
  const divider = section(input, 'divider');
  const layout = section(input, 'layout');
  return {
    schemaVersion: 1,
    canvas: {
      background: color(canvas.background, 'canvas.background'),
      textColor: color(canvas.textColor, 'canvas.textColor'),
      maxWidth: number(canvas.maxWidth, 320, 677, 'canvas.maxWidth', { integer: true }),
    },
    title: {
      fontSize: number(title.fontSize, 20, 48, 'title.fontSize', { integer: true }),
      fontWeight: number(title.fontWeight, 400, 900, 'title.fontWeight', { integer: true }),
      lineHeight: number(title.lineHeight, 1.1, 2, 'title.lineHeight'),
      color: color(title.color, 'title.color'),
    },
    body: {
      fontSize: number(body.fontSize, 12, 24, 'body.fontSize', { integer: true }),
      lineHeight: number(body.lineHeight, 1.2, 2.5, 'body.lineHeight'),
      paragraphSpacing: number(body.paragraphSpacing, 0, 40, 'body.paragraphSpacing', { integer: true }),
    },
    heading: {
      fontSize: number(heading.fontSize, 16, 36, 'heading.fontSize', { integer: true }),
      color: color(heading.color, 'heading.color'),
      borderColor: color(heading.borderColor, 'heading.borderColor'),
    },
    quote: {
      background: color(quote.background, 'quote.background'),
      borderColor: color(quote.borderColor, 'quote.borderColor'),
    },
    image: {
      borderRadius: number(image.borderRadius, 0, 24, 'image.borderRadius', { integer: true }),
      spacing: number(image.spacing, 0, 40, 'image.spacing', { integer: true }),
      captionColor: color(image.captionColor, 'image.captionColor'),
    },
    divider: {
      color: color(divider.color, 'divider.color'),
      thickness: number(divider.thickness, 1, 4, 'divider.thickness', { integer: true }),
    },
    layout: {
      titleVariant: enumValue(layout.titleVariant, RULE_ENUMS.titleVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.titleVariant, 'layout.titleVariant'),
      headingVariant: enumValue(layout.headingVariant, RULE_ENUMS.headingVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.headingVariant, 'layout.headingVariant'),
      imageVariant: enumValue(layout.imageVariant, RULE_ENUMS.imageVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.imageVariant, 'layout.imageVariant'),
      quoteVariant: enumValue(layout.quoteVariant, RULE_ENUMS.quoteVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.quoteVariant, 'layout.quoteVariant'),
      dividerVariant: enumValue(layout.dividerVariant, RULE_ENUMS.dividerVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.dividerVariant, 'layout.dividerVariant'),
      leadVariant: enumValue(layout.leadVariant, RULE_ENUMS.leadVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.leadVariant, 'layout.leadVariant'),
      tocVariant: enumValue(layout.tocVariant, RULE_ENUMS.tocVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.tocVariant, 'layout.tocVariant'),
      listVariant: enumValue(layout.listVariant, RULE_ENUMS.listVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.listVariant, 'layout.listVariant'),
      linkVariant: enumValue(layout.linkVariant, RULE_ENUMS.linkVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.linkVariant, 'layout.linkVariant'),
      tagVariant: enumValue(layout.tagVariant, RULE_ENUMS.tagVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.tagVariant, 'layout.tagVariant'),
      metaVariant: enumValue(layout.metaVariant, RULE_ENUMS.metaVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.metaVariant, 'layout.metaVariant'),
      paragraphVariant: enumValue(layout.paragraphVariant, RULE_ENUMS.paragraphVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.paragraphVariant, 'layout.paragraphVariant'),
      inlineVariant: enumValue(layout.inlineVariant, RULE_ENUMS.inlineVariant, DEFAULT_WECHAT_LAYOUT_RULES.layout.inlineVariant, 'layout.inlineVariant'),
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

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function trimText(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeLayoutAddon(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { enabled: false, label: '', title: '', body: '' };
  }
  const label = trimText(value.label, 24);
  const title = trimText(value.title, 80);
  const body = trimText(value.body, 500);
  const imageAssetId = typeof value.imageAssetId === 'string' && /^[0-9a-f-]{36}$/i.test(value.imageAssetId) ? value.imageAssetId : null;
  const template = ['CARD', 'MINIMAL', 'BANNER'].includes(value.template) ? value.template : 'CARD';
  return {
    enabled: Boolean(value.enabled) && Boolean(label || title || body || imageAssetId),
    label,
    title,
    body,
    imageAssetId,
    template,
  };
}

function normalizeLayoutAddons(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    intro: normalizeLayoutAddon(value.intro),
    outro: normalizeLayoutAddon(value.outro),
  };
}

function layoutAddonHtml(addon, position, rules) {
  if (!addon.enabled) return '';
  const isOutro = position === 'outro';
  const label = addon.label ? `<span style="display:inline-block;margin:0 0 9px;padding:3px 8px;border-radius:999px;background:${rules.heading.borderColor};color:${rules.canvas.background};font-size:11px;font-weight:800;line-height:1.45;">${escapeHtml(addon.label)}</span>` : '';
  const title = addon.title ? `<b style="display:block;margin:0 0 ${addon.body ? 8 : 0}px;color:${rules.title.color};font-size:${Math.max(17, rules.heading.fontSize - 2)}px;line-height:1.45;font-weight:800;letter-spacing:0;word-break:break-word;">${escapeHtml(addon.title)}</b>` : '';
  const body = addon.body ? `<p style="margin:0;color:${rules.canvas.textColor};font-size:${Math.max(13, rules.body.fontSize - 1)}px;line-height:${Math.max(1.55, Number((rules.body.lineHeight - 0.12).toFixed(2)))};letter-spacing:0;word-break:break-word;">${inlineHtml(addon.body, rules)}</p>` : '';
  const image = addon.imageAssetId ? `<img data-asset-id="${addon.imageAssetId}" src="/api/v1/assets/${addon.imageAssetId}/content" alt="" style="display:block;width:100%;max-height:220px;object-fit:cover;border-radius:${rules.image.borderRadius}px;margin:0 0 12px;">` : '';
  const templateStyle = addon.template === 'MINIMAL'
    ? 'padding:12px 0;border:0;background:transparent;'
    : addon.template === 'BANNER'
      ? `padding:18px 20px;border:0;border-radius:0;background:${rules.heading.borderColor};color:${rules.canvas.background};`
      : `padding:16px 18px;border:1px solid ${rules.divider.color};border-left:6px solid ${rules.heading.borderColor};background:${rules.quote.background};`;
  const content = `${image}${label}${title}${body}`;
  if (isOutro) {
    return `<section data-layout-addon="outro" style="margin:${rules.body.paragraphSpacing + 10}px 0 0;${templateStyle}text-align:center;">${content}</section>`;
  }
  return `<section data-layout-addon="intro" style="margin:0 0 ${rules.body.paragraphSpacing + 8}px;${templateStyle}">${content}</section>`;
}

function contrastAccentColor(rules) {
  if (rules.layout.inlineVariant === 'dual') return '#4f68a8';
  if (rules.layout.inlineVariant === 'mono') return rules.canvas.textColor;
  return rules.heading.color;
}

function strongStyle(rules) {
  if (rules.layout.inlineVariant === 'accent' || rules.layout.inlineVariant === 'dual') return `font-weight:800;color:${rules.heading.borderColor};`;
  if (rules.layout.inlineVariant === 'marker') return `display:inline;padding:0 3px;background:${rules.quote.background};color:${rules.heading.borderColor};font-weight:800;`;
  if (rules.layout.inlineVariant === 'mono') return `font-weight:800;color:${rules.canvas.textColor};border-bottom:1px solid ${rules.divider.color};`;
  return `font-weight:800;color:${rules.title.color};`;
}

function markStyle(rules) {
  if (rules.layout.inlineVariant === 'dual') return `color:${rules.heading.borderColor};font-weight:800;`;
  if (rules.layout.inlineVariant === 'mono') return `font-weight:800;color:${rules.canvas.textColor};background:${rules.quote.background};`;
  return `display:inline;padding:0 4px;background:${rules.quote.background};color:${rules.heading.borderColor};font-weight:800;`;
}

function codeStyle(rules) {
  const color = contrastAccentColor(rules);
  return `display:inline-block;margin:0 2px;padding:1px 6px;border-radius:4px;background:${rules.quote.background};color:${color};font-family:Menlo,Consolas,monospace;font-size:${Math.max(12, rules.body.fontSize - 1)}px;line-height:1.45;`;
}

function linkStyle(rules) {
  const color = rules.layout.inlineVariant === 'dual' ? contrastAccentColor(rules) : rules.heading.color;
  if (rules.layout.linkVariant === 'pill') {
    return `display:inline-block;margin:0 2px;padding:1px 7px;border:1px solid ${rules.heading.borderColor};border-radius:999px;color:${color};text-decoration:none;font-weight:700;background:${rules.quote.background};`;
  }
  if (rules.layout.linkVariant === 'accent') {
    return `color:${color};text-decoration:none;border-bottom:1px solid ${rules.heading.borderColor};font-weight:700;`;
  }
  return `color:${color};text-decoration:underline;text-underline-offset:3px;`;
}

function inlineHtml(value, rules) {
  const text = String(value ?? '');
  const pattern = /(`[^`\n]+`|==[^=\n]+==|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<]+)/g;
  let output = '';
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    output += escapeHtml(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      output += `<strong style="${strongStyle(rules)}">${escapeHtml(token.slice(2, -2))}</strong>`;
    } else if (token.startsWith('==')) {
      output += `<mark style="${markStyle(rules)}">${escapeHtml(token.slice(2, -2))}</mark>`;
    } else if (token.startsWith('`')) {
      output += `<code style="${codeStyle(rules)}">${escapeHtml(token.slice(1, -1))}</code>`;
    } else {
      const markdown = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      const label = markdown ? markdown[1] : token;
      const href = safeUrl(markdown ? markdown[2] : token);
      output += href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${linkStyle(rules)}">${escapeHtml(label)}</a>`
        : escapeHtml(token);
    }
    cursor = match.index + token.length;
  }
  output += escapeHtml(text.slice(cursor));
  return output.replace(/\n/g, '<br>');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyLayoutInlineMarks(value, layoutDesign) {
  let text = String(value ?? '');
  const marks = Array.isArray(layoutDesign?.inlineMarks) ? layoutDesign.inlineMarks : [];
  marks
    .filter((mark) => typeof mark?.text === 'string' && mark.text.length >= 2 && !/[<>]/.test(mark.text))
    .sort((left, right) => right.text.length - left.text.length)
    .forEach((mark) => {
      const wrapper = mark.type === 'marker' ? ['==', '=='] : mark.type === 'code' ? ['`', '`'] : ['**', '**'];
      text = text.replace(new RegExp(`(?<![*=\`])${escapeRegExp(mark.text)}(?![*=\`])`, 'g'), `${wrapper[0]}${mark.text}${wrapper[1]}`);
    });
  return text;
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

function normalizeLayoutDesign(layoutDesign) {
  if (!layoutDesign || typeof layoutDesign !== 'object' || Array.isArray(layoutDesign)) return { schemaVersion: 1, blocks: [], inlineMarks: [] };
  const blocks = Array.isArray(layoutDesign.blocks) ? layoutDesign.blocks.flatMap((item) => {
    const paragraphIndex = Number(item?.paragraphIndex);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1) return [];
    const role = ['lead', 'key-judgement', 'section-summary', 'quote', 'normal'].includes(item?.role) ? item.role : 'normal';
    const variant = ['accent-line', 'callout', 'card', 'plain'].includes(item?.variant) ? item.variant : 'plain';
    return [{ paragraphIndex, role, variant }];
  }).slice(0, 24) : [];
  const inlineMarks = Array.isArray(layoutDesign.inlineMarks) ? layoutDesign.inlineMarks.flatMap((item) => {
    const text = String(item?.text ?? '').trim();
    if (text.length < 2 || text.length > 80 || /[<>]/.test(text)) return [];
    const type = ['strong', 'strong-accent', 'marker', 'code'].includes(item?.type) ? item.type : 'strong';
    return [{ text, type }];
  }).slice(0, 80) : [];
  return { schemaVersion: 1, blocks, inlineMarks };
}

function titleHtml(title, rules) {
  const text = escapeHtml(title);
  const base = `font-size:${rules.title.fontSize}px;font-weight:${rules.title.fontWeight};line-height:${rules.title.lineHeight};color:${rules.title.color};letter-spacing:0;word-break:break-word;`;
  if (rules.layout.titleVariant === 'bar') {
    return `<header style="margin:0 0 26px;padding:0 0 16px;border-bottom:${rules.divider.thickness + 1}px solid ${rules.heading.borderColor};"><div style="width:56px;height:6px;margin-bottom:14px;background:${rules.heading.borderColor};"></div><h1 style="margin:0;${base}">${text}</h1></header>`;
  }
  if (rules.layout.titleVariant === 'card') {
    return `<header style="margin:0 0 26px;padding:18px 20px;border:1px solid ${rules.heading.borderColor};border-left:8px solid ${rules.heading.borderColor};background:${rules.quote.background};"><h1 style="margin:0;${base}">${text}</h1></header>`;
  }
  if (rules.layout.titleVariant === 'label') {
    return `<header style="margin:0 0 26px;"><span style="display:inline-block;margin-bottom:12px;padding:4px 10px;border-radius:999px;background:${rules.heading.borderColor};color:${rules.canvas.background};font-size:12px;font-weight:700;line-height:1.4;">公众号精选</span><h1 style="margin:0;${base}">${text}</h1></header>`;
  }
  if (rules.layout.titleVariant === 'split') {
    return `<header style="margin:0 0 28px;padding:18px 0;border-top:4px solid ${rules.heading.borderColor};border-bottom:1px solid ${rules.divider.color};"><h1 style="margin:0;${base}">${text}</h1></header>`;
  }
  if (rules.layout.titleVariant === 'poster') {
    return `<header style="margin:0 0 28px;padding:26px 22px;background:${rules.title.color};"><h1 style="margin:0;font-size:${rules.title.fontSize}px;font-weight:${rules.title.fontWeight};line-height:${rules.title.lineHeight};color:${rules.canvas.background};letter-spacing:0;word-break:break-word;">${text}</h1></header>`;
  }
  if (rules.layout.titleVariant === 'news') {
    return `<header style="margin:0 0 26px;"><h1 style="margin:0;${base}">${text}</h1><p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:${rules.image.captionColor};letter-spacing:0;"><span style="color:${rules.heading.color};font-weight:600;">精选栏目</span><span style="margin-left:10px;">原创 · 深度阅读</span></p></header>`;
  }
  return `<h1 style="margin:0 0 22px;${base}">${text}</h1>`;
}

function headingHtml(text, rules, index) {
  const base = `font-size:${rules.heading.fontSize}px;line-height:1.45;color:${rules.heading.color};font-weight:700;letter-spacing:0;word-break:break-word;`;
  const margin = `${rules.body.paragraphSpacing}px 0 ${Math.max(8, Math.round(rules.body.paragraphSpacing / 2))}px`;
  if (rules.layout.headingVariant === 'pill') {
    return `<h2 style="margin:${margin};"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${rules.quote.background};border:1px solid ${rules.heading.borderColor};${base}">${text}</span></h2>`;
  }
  if (rules.layout.headingVariant === 'underline') {
    return `<h2 style="margin:${margin};padding-bottom:8px;border-bottom:${rules.divider.thickness + 1}px solid ${rules.heading.borderColor};${base}">${text}</h2>`;
  }
  if (rules.layout.headingVariant === 'numbered') {
    return `<h2 style="display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;margin:${margin};${base}"><span style="display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:${rules.heading.borderColor};color:${rules.canvas.background};font-size:14px;">${String(index).padStart(2, '0')}</span><span>${text}</span></h2>`;
  }
  if (rules.layout.headingVariant === 'band') {
    return `<h2 style="margin:${margin};padding:10px 14px;background:${rules.quote.background};border-left:0;border-bottom:3px solid ${rules.heading.borderColor};${base}">${text}</h2>`;
  }
  if (rules.layout.headingVariant === 'stamp') {
    return `<h2 style="margin:${margin};"><span style="display:inline-block;padding:5px 9px;border:2px solid ${rules.heading.borderColor};box-shadow:3px 3px 0 ${rules.quote.background};${base}">${text}</span></h2>`;
  }
  if (rules.layout.headingVariant === 'shadow-card') {
    return `<section style="position:relative;margin:${rules.body.paragraphSpacing + 8}px 0 ${Math.max(14, rules.body.paragraphSpacing)}px;padding:0 28px 0 0;"><span style="position:absolute;right:0;top:-10px;width:72px;height:88px;background:${rules.quote.background};opacity:.9;"></span><h2 style="position:relative;margin:0;padding:22px 28px;background:${rules.canvas.background};box-shadow:0 8px 18px rgba(15,23,42,.08);border-radius:6px;${base}"><span style="display:inline-block;width:2px;height:20px;margin:0 18px 0 0;vertical-align:-4px;background:${rules.heading.borderColor};"></span>${text}</h2></section>`;
  }
  if (rules.layout.headingVariant === 'center-underline') {
    return `<h2 style="margin:${rules.body.paragraphSpacing + 8}px 0 ${Math.max(12, rules.body.paragraphSpacing)}px;text-align:center;${base}"><span style="display:inline-block;padding:0 4px 5px;border-bottom:${Math.max(2, rules.divider.thickness)}px solid ${rules.heading.borderColor};">${text}</span></h2>`;
  }
  return `<h2 style="margin:${margin};padding-left:10px;border-left:3px solid ${rules.heading.borderColor};${base}">${text}</h2>`;
}

function quoteHtml(value, rules) {
  const text = inlineHtml(value, rules);
  const base = `margin:${rules.body.paragraphSpacing}px 0;font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;`;
  if (rules.layout.quoteVariant === 'card') return `<blockquote style="${base}padding:16px 18px;border:1px solid ${rules.quote.borderColor};background:${rules.quote.background};">${text}</blockquote>`;
  if (rules.layout.quoteVariant === 'bubble') return `<blockquote style="${base}padding:16px 18px;border-radius:18px 18px 18px 4px;background:${rules.quote.background};box-shadow:inset 0 0 0 1px ${rules.quote.borderColor};">${text}</blockquote>`;
  if (rules.layout.quoteVariant === 'outline') return `<blockquote style="${base}padding:14px 16px;border-top:1px solid ${rules.quote.borderColor};border-bottom:1px solid ${rules.quote.borderColor};background:transparent;">${text}</blockquote>`;
  return `<blockquote style="${base}padding:12px 16px;border-left:4px solid ${rules.quote.borderColor};background:${rules.quote.background};">${text}</blockquote>`;
}

function listHtml(lines, rules) {
  const base = `margin:0 0 ${rules.body.paragraphSpacing}px;font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;`;
  const items = lines.map((line) => line.replace(/^[-*]\s+/, ''));
  if (rules.layout.listVariant === 'spaced') {
    return `<ul style="${base}display:grid;gap:10px;padding-left:1.2em;">${items.map((item) => `<li>${inlineHtml(item, rules)}</li>`).join('')}</ul>`;
  }
  if (rules.layout.listVariant === 'check') {
    return `<ul style="${base}display:grid;gap:10px;padding-left:0;list-style:none;">${items.map((item) => `<li style="display:grid;grid-template-columns:18px minmax(0,1fr);gap:9px;"><span style="display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:${rules.heading.borderColor};color:${rules.canvas.background};font-size:12px;font-weight:800;">✓</span><span>${inlineHtml(item, rules)}</span></li>`).join('')}</ul>`;
  }
  if (rules.layout.listVariant === 'bold') {
    return `<ul style="${base}display:grid;gap:10px;padding-left:1.5em;">${items.map((item) => `<li style="padding-left:2px;">${inlineHtml(item, rules)}</li>`).join('')}</ul>`;
  }
  return `<ul style="${base}padding-left:1.5em;">${items.map((item) => `<li>${inlineHtml(item, rules)}</li>`).join('')}</ul>`;
}

function dividerHtml(rules) {
  const margin = `${rules.body.paragraphSpacing}px 0`;
  if (rules.layout.dividerVariant === 'dots') return `<div role="separator" style="margin:${margin};text-align:center;color:${rules.divider.color};font-size:18px;line-height:1;">•••</div>`;
  if (rules.layout.dividerVariant === 'label') return `<div role="separator" style="display:flex;align-items:center;gap:10px;margin:${margin};color:${rules.divider.color};font-size:11px;font-weight:700;"><span style="height:1px;flex:1;background:${rules.divider.color};"></span><span>继续阅读</span><span style="height:1px;flex:1;background:${rules.divider.color};"></span></div>`;
  return `<hr style="border:0;border-top:${rules.divider.thickness}px solid ${rules.divider.color};margin:${margin};">`;
}

function paragraphHtml(value, rules, paragraphIndex, layoutDesign) {
  const raw = String(value ?? '').trim();
  const designBlock = layoutDesign?.blocks?.find((item) => item.paragraphIndex === paragraphIndex);
  const text = inlineHtml(applyLayoutInlineMarks(raw, layoutDesign), rules);
  const baseStyle = `margin:0 0 ${rules.body.paragraphSpacing}px;font-size:${rules.body.fontSize}px;line-height:${rules.body.lineHeight};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;`;
  if (designBlock && designBlock.variant !== 'plain') {
    const role = escapeHtml(designBlock.role);
    if (designBlock.variant === 'accent-line') return `<p data-layout-design-block="${role}" style="${baseStyle}padding:0 0 0 14px;border-left:5px solid ${rules.heading.borderColor};font-size:${rules.body.fontSize + 1}px;font-weight:600;color:${rules.title.color};">${text}</p>`;
    if (designBlock.variant === 'callout') return `<p data-layout-design-block="${role}" style="${baseStyle}padding:16px 18px;border:1px solid ${rules.quote.borderColor};background:${rules.quote.background};font-size:${rules.body.fontSize + 1}px;font-weight:600;color:${rules.title.color};">${text}</p>`;
    if (designBlock.variant === 'card') return `<p data-layout-design-block="${role}" style="${baseStyle}padding:16px 18px;border-radius:8px;border:1px solid ${rules.divider.color};background:${rules.quote.background};">${text}</p>`;
  }
  if (paragraphIndex === 1 && rules.layout.leadVariant !== 'none') {
    if (rules.layout.leadVariant === 'card') return `<p style="${baseStyle}padding:16px 18px;border:1px solid ${rules.divider.color};background:${rules.quote.background};font-size:${rules.body.fontSize + 1}px;">${text}</p>`;
    if (rules.layout.leadVariant === 'stripe') return `<p style="${baseStyle}padding:0 0 0 14px;border-left:5px solid ${rules.heading.borderColor};font-size:${rules.body.fontSize + 1}px;font-weight:600;color:${rules.title.color};">${text}</p>`;
    if (rules.layout.leadVariant === 'kicker') return `<p style="${baseStyle}"><span style="float:left;margin:6px 9px 0 0;font-size:44px;line-height:.8;color:${rules.heading.borderColor};font-weight:800;">${escapeHtml(raw.slice(0, 1))}</span>${inlineHtml(raw.slice(1), rules)}</p>`;
  }
  if (rules.layout.paragraphVariant === 'indent') return `<p style="${baseStyle}text-indent:2em;text-align:justify;">${text}</p>`;
  if (rules.layout.paragraphVariant === 'rail') return `<p style="${baseStyle}padding:0 0 0 14px;border-left:2px solid ${rules.divider.color};">${text}</p>`;
  if (rules.layout.paragraphVariant === 'card') return `<p style="${baseStyle}padding:14px 16px;border:1px solid ${rules.divider.color};border-radius:6px;background:${rules.quote.background};">${text}</p>`;
  if (rules.layout.paragraphVariant === 'report') return `<p style="${baseStyle}margin:0 0 ${Math.max(10, rules.body.paragraphSpacing - 2)}px;padding:0 0 ${Math.max(8, Math.round(rules.body.paragraphSpacing * 0.55))}px;border-bottom:1px solid ${rules.divider.color};">${text}</p>`;
  if (rules.layout.paragraphVariant === 'newspaper') return `<p style="${baseStyle}margin:0 0 ${Math.max(10, rules.body.paragraphSpacing - 4)}px;padding:10px 0;border-top:${paragraphIndex % 2 === 0 ? 1 : 0}px solid ${rules.divider.color};font-size:${Math.max(14, rules.body.fontSize - 1)}px;line-height:${Math.max(1.55, Number((rules.body.lineHeight - 0.08).toFixed(2)))};">${text}</p>`;
  if (rules.layout.paragraphVariant === 'case-card') {
    if (paragraphIndex === 1) return `<p style="${baseStyle}margin:0 0 ${Math.max(28, rules.body.paragraphSpacing + 10)}px;text-align:justify;">${text}</p>`;
    const caseNumber = paragraphIndex - 1;
    return `<p data-layout-case-card="${caseNumber}" style="${baseStyle}position:relative;margin:${Math.max(40, rules.body.paragraphSpacing + 24)}px 0 ${Math.max(30, rules.body.paragraphSpacing + 12)}px;padding:34px 24px 24px;border:1px solid ${rules.heading.borderColor};border-radius:10px;background:${rules.canvas.background};font-size:${rules.body.fontSize}px;line-height:${Math.max(1.75, rules.body.lineHeight)};text-align:justify;"><span style="position:absolute;left:36px;top:-31px;display:block;padding:0 10px;background:${rules.canvas.background};color:${rules.heading.borderColor};font-size:${Math.max(42, rules.heading.fontSize + 22)}px;line-height:1;font-weight:900;">${caseNumber}</span><span style="position:absolute;left:36px;top:-5px;width:9px;height:9px;border-radius:50%;background:#f6c23e;"></span><span style="position:absolute;left:132px;right:14px;top:-1px;height:1px;background:${rules.heading.borderColor};"></span>${text}</p>`;
  }
  return `<p style="${baseStyle}">${text}</p>`;
}

function extractHeadings(body) {
  return String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map((block) => /^#{1,3}\s+([\s\S]+)$/.exec(block.trim()))
    .filter(Boolean)
    .map((match) => String(match[1] ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function tocHtml(headings, rules) {
  if (rules.layout.tocVariant === 'none' || headings.length < 2) return '';
  const items = headings.map((heading, index) => {
    const marker = rules.layout.tocVariant === 'index' ? String(index + 1).padStart(2, '0') : '•';
    return `<li style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start;margin:0;"><span style="color:${rules.heading.borderColor};font-weight:800;font-size:13px;">${marker}</span><span>${escapeHtml(heading)}</span></li>`;
  }).join('');
  if (rules.layout.tocVariant === 'card') {
    return `<nav aria-label="全文目录" style="margin:0 0 ${rules.body.paragraphSpacing + 8}px;padding:16px 18px;border:1px solid ${rules.divider.color};background:${rules.quote.background};"><b style="display:block;margin:0 0 12px;color:${rules.title.color};font-size:${rules.body.fontSize}px;">全文目录</b><ol style="display:grid;gap:8px;margin:0;padding:0;list-style:none;font-size:${Math.max(13, rules.body.fontSize - 1)}px;line-height:1.55;color:${rules.canvas.textColor};">${items}</ol></nav>`;
  }
  return `<nav aria-label="全文目录" style="margin:0 0 ${rules.body.paragraphSpacing + 8}px;"><b style="display:block;margin:0 0 10px;color:${rules.title.color};font-size:${rules.body.fontSize}px;">全文目录</b><ol style="display:grid;gap:8px;margin:0;padding:0;list-style:none;font-size:${Math.max(13, rules.body.fontSize - 1)}px;line-height:1.55;color:${rules.canvas.textColor};">${items}</ol></nav>`;
}

function tagHtml(headings, rules) {
  if (rules.layout.tagVariant === 'none' || headings.length === 0) return '';
  const tags = headings.slice(0, 4);
  if (rules.layout.tagVariant === 'rail') {
    return `<div aria-label="内容标签" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 ${rules.body.paragraphSpacing}px;padding-left:10px;border-left:3px solid ${rules.heading.borderColor};">${tags.map((tag) => `<span style="font-size:12px;line-height:1.5;color:${rules.heading.color};font-weight:700;">${escapeHtml(tag)}</span>`).join('')}</div>`;
  }
  if (rules.layout.tagVariant === 'mono') {
    return `<div aria-label="内容标签" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 ${rules.body.paragraphSpacing}px;">${tags.map((tag) => `<span style="padding:3px 7px;border:1px solid ${rules.divider.color};font:12px monospace;color:${rules.canvas.textColor};background:${rules.canvas.background};">#${escapeHtml(tag)}</span>`).join('')}</div>`;
  }
  return `<div aria-label="内容标签" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 ${rules.body.paragraphSpacing}px;">${tags.map((tag) => `<span style="padding:4px 9px;border-radius:999px;background:${rules.quote.background};color:${rules.heading.color};font-size:12px;font-weight:700;line-height:1.4;">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function bodyBlocks(body, rules, layoutDesign) {
  let headingIndex = 0;
  let paragraphIndex = 0;
  return String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).map((block) => {
    if (/^(?:---|\*\*\*)$/.test(block)) return dividerHtml(rules);
    const heading = /^#{1,3}\s+([\s\S]+)$/.exec(block);
    if (heading) return headingHtml(escapeHtml(heading[1].trim()), rules, ++headingIndex);
    if (block.split('\n').every((line) => /^>\s?/.test(line))) {
      const value = block.split('\n').map((line) => line.replace(/^>\s?/, '')).join('\n');
      return quoteHtml(value, rules);
    }
    const lines = block.split('\n');
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return listHtml(lines, rules);
    }
    return paragraphHtml(block, rules, ++paragraphIndex, layoutDesign);
  });
}

function imageHtml(asset, rules) {
  const img = `<img src="/api/v1/assets/${asset.assetId}/content" alt="" style="display:block;width:100%;height:auto;border-radius:${rules.image.borderRadius}px;">`;
  if (rules.layout.imageVariant === 'framed') return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;padding:10px;border:1px solid ${rules.divider.color};background:${rules.quote.background};">${img}</figure>`;
  if (rules.layout.imageVariant === 'shadow') return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;">${img.replace('style="', `style="box-shadow:0 12px 28px rgba(15,23,42,.16);`)}</figure>`;
  if (rules.layout.imageVariant === 'bleed') return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px -18px;">${img}</figure>`;
  if (rules.layout.imageVariant === 'cutout') return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;padding:0 0 10px;border-bottom:4px solid ${rules.heading.borderColor};">${img}</figure>`;
  if (rules.layout.imageVariant === 'poster') return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;padding:12px;background:${rules.title.color};">${img}</figure>`;
  return `<figure data-asset-id="${asset.assetId}" data-asset-role="${asset.role}" style="margin:${rules.image.spacing}px 0;">${img}</figure>`;
}

function paragraphInsertionMap(body, assets, visualPlan) {
  const plan = Array.isArray(visualPlan?.plan) ? visualPlan.plan : [];
  const normalizeAnchorText = (value) => String(value ?? '').replace(/[#>*_`~\[\]]/g, ' ').replace(/\s+/g, '').trim();
  const paragraphs = String(body ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
    .filter((block) => !/^(?:---|\*\*\*)$/.test(block) && !/^#{1,3}\s+/.test(block) && !block.split('\n').every((line) => /^>\s?/.test(line)) && !block.split('\n').every((line) => /^[-*]\s+/.test(line)));
  const result = new Map();
  const unmatched = [];
  for (const asset of assets) {
    const item = plan.find((candidate) => candidate?.assetId === asset.assetId);
    if (!item || asset.role === 'COVER' || asset.role === 'MAIN') continue;
    const explicit = Number(item.insertion?.paragraphIndex ?? item.paragraphIndex);
    if (Number.isInteger(explicit) && explicit >= 1) { result.set(asset.assetId, Math.min(explicit, Math.max(1, paragraphs.length))); continue; }
    const excerpt = normalizeAnchorText(item.sourceExcerpt);
    const placement = normalizeAnchorText(item.placement);
    const index = paragraphs.findIndex((paragraph) => {
      const normalized = normalizeAnchorText(paragraph);
      return (excerpt.length >= 8 && normalized.includes(excerpt)) || (placement.length >= 8 && normalized.includes(placement));
    });
    if (index >= 0) result.set(asset.assetId, index + 1); else unmatched.push(asset);
  }
  // 旧数据没有可匹配的正文摘录时，也要把图片分布到正文中，不能全部追加到末尾。
  unmatched.forEach((asset, index) => {
    const paragraphIndex = paragraphs.length ? Math.max(1, Math.min(paragraphs.length, Math.ceil(((index + 1) * paragraphs.length) / (unmatched.length + 1)))) : 1;
    result.set(asset.assetId, paragraphIndex);
  });
  return result;
}

function interleaveContent(blocks, assets, rules, body, visualPlan) {
  const coverIndex = assets.findIndex(({ role }) => role === 'COVER' || role === 'MAIN');
  const cover = coverIndex >= 0 ? assets[coverIndex] : assets[0];
  const remaining = assets.filter((_, index) => index !== (coverIndex >= 0 ? coverIndex : 0));
  const output = [];
  if (cover) output.push(imageHtml(cover, rules));
  if (!blocks.length) return output.concat(remaining.map((item) => imageHtml(item, rules)));
  const insertionMap = paragraphInsertionMap(body, remaining, visualPlan);
  if (insertionMap.size) {
    const outputByParagraph = new Map();
    remaining.forEach((asset, index) => {
      const paragraph = insertionMap.get(asset.assetId) ?? (Number.MAX_SAFE_INTEGER - remaining.length + index);
      const bucket = outputByParagraph.get(paragraph) ?? [];
      bucket.push(asset);
      outputByParagraph.set(paragraph, bucket);
    });
    let paragraphIndex = 0;
    blocks.forEach((block) => { output.push(block); if (/^<p\b/i.test(block)) paragraphIndex += 1; const bucket = outputByParagraph.get(paragraphIndex) ?? []; bucket.forEach((asset) => output.push(imageHtml(asset, rules))); });
    const inserted = new Set(output.filter((value) => typeof value === 'string' && value.includes('data-asset-id=')).map((value) => /data-asset-id="([^"]+)"/.exec(value)?.[1]).filter(Boolean));
    remaining.filter((asset) => !inserted.has(asset.assetId)).forEach((asset) => output.push(imageHtml(asset, rules)));
    return output;
  }
  const interval = remaining.length ? Math.max(1, Math.ceil(blocks.length / remaining.length)) : Number.POSITIVE_INFINITY;
  let imageIndex = 0;
  blocks.forEach((block, index) => {
    output.push(block);
    if ((index + 1) % interval === 0 && imageIndex < remaining.length) output.push(imageHtml(remaining[imageIndex++], rules));
  });
  while (imageIndex < remaining.length) output.push(imageHtml(remaining[imageIndex++], rules));
  return output;
}

function renderWechatDraft({ title, body, assets = [], templateRules, layoutAddons, layoutDesign, visualPlan }) {
  const rules = normalizeWechatLayoutRules(templateRules);
  const normalizedAssets = normalizeAssets(assets);
  const normalizedLayoutDesign = normalizeLayoutDesign(layoutDesign);
  const checks = normalizedAssets.length ? [] : [{ level: 'WARNING', code: 'DRAFT_IMAGE_MISSING', message: '公众号草稿还没有配置图片。' }];
  const headings = extractHeadings(body);
  const addons = normalizeLayoutAddons(layoutAddons);
  const prefix = `${tagHtml(headings, rules)}${tocHtml(headings, rules)}`;
  const addonAssetIds = new Set([addons.intro.imageAssetId, addons.outro.imageAssetId].filter(Boolean));
  const contentAssets = normalizedAssets.filter((asset) => !addonAssetIds.has(asset.assetId));
  const content = `${layoutAddonHtml(addons.intro, 'intro', rules)}${prefix}${interleaveContent(bodyBlocks(body, rules, normalizedLayoutDesign), contentAssets, rules, body, visualPlan).join('')}${layoutAddonHtml(addons.outro, 'outro', rules)}`;
  const html = `<article data-layout-schema="1" style="box-sizing:border-box;width:100%;max-width:${rules.canvas.maxWidth}px;margin:0 auto;padding:24px 18px;background:${rules.canvas.background};color:${rules.canvas.textColor};letter-spacing:0;word-break:break-word;">${titleHtml(title, rules)}${content}</article>`;
  return { html, checks };
}

module.exports = { DEFAULT_WECHAT_LAYOUT_RULES, normalizeWechatLayoutRules, renderWechatDraft };
