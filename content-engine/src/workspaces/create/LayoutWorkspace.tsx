import { Check, Edit3, FileText, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WebApiError, webAssets, webDrafts, webWechatTemplates } from '../../data/webApi';
import type { ContentDraft, ContentDraftVersion, WechatLayoutPreview, WechatLayoutRules, WechatLayoutTemplate } from '../../domain/content-drafts';
import type { ProjectAsset } from '../../domain/assets';
import { AssetPickerDialog } from '../../components/assets/AssetPickerDialog';
import { WechatLayoutTemplatePicker, type TemplateNotice } from './WechatLayoutTemplatePicker';

function noticeFor(error: unknown, action: 'load' | 'import' | 'duplicate' | 'remove' | 'preview' | 'complete' | 'design'): TemplateNotice {
  if (error instanceof WebApiError) {
    if (error.code === 'TASK_POLICY_REQUIRED') return { tone: 'error', message: action === 'design' ? '缺少“公众号智能精排”任务策略，请先在模型与 API 中配置。' : '缺少“公众号模板分析”任务策略，请先在模型与 API 中配置。' };
    if (error.code === 'LAYOUT_TEMPLATE_RULES_INVALID') return { tone: 'error', message: '模型返回的排版规则不合规，模板没有保存。' };
    if (error.code === 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE') return { tone: 'error', message: '公众号文章页面暂时读取不到，可能已失效、未公开，或触发了微信访问限制。请换一个公开可读链接，或先复制系统模板做自定义调整。' };
    if (error.code === 'LAYOUT_TEMPLATE_IN_USE') return { tone: 'error', message: '该模板正在被草稿或历史版本使用，不能删除。' };
    if (error.code === 'LAYOUT_TEMPLATE_NAME_CONFLICT') return { tone: 'error', message: '已有同名模板，请换一个名称。' };
    if (action === 'import' && [502, 503, 504].includes(error.status)) return { tone: 'error', message: '模板分析模型或外部服务暂时不可用。请检查“模型与 API”的公众号模板分析策略，稍后重试，或先复制系统模板做自定义调整。' };
    if (action === 'import' && error.status >= 500) return { tone: 'error', message: '导入模板时服务端发生异常，模板没有保存。请稍后重试；如果反复出现，查看 API 日志里的公众号模板分析错误。' };
    if (error.code === 'LAYOUT_TEMPLATE_SOURCE_INVALID' || error.code === 'LAYOUT_TEMPLATE_SOURCE_UNSUPPORTED') return { tone: 'error', message: '链接不是可读取的公众号文章，请检查后重试。' };
    return { tone: 'error', message: error.message };
  }
  const messages = {
    load: '读取排版模板失败。',
    import: '导入公众号模板失败。',
    duplicate: '复制模板失败。',
    remove: '删除模板失败。',
    preview: '生成排版预览失败。',
    complete: '保存公众号草稿失败。',
    design: '智能精排失败。',
  };
  return { tone: 'error', message: error instanceof Error ? error.message : messages[action] };
}

function previewDocument(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function thumbnailPreviewHtml(template: WechatLayoutTemplate) {
  const rules: WechatLayoutRules = template.rules;
  const layout = {
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
    ...(rules.layout ?? {}),
  };
  const shell = `box-sizing:border-box;width:100%;max-width:${Math.min(420, rules.canvas.maxWidth)}px;margin:0 auto;padding:20px 18px;background:${rules.canvas.background};color:${rules.canvas.textColor};`;
  const titleBase = `font-size:${Math.max(24, rules.title.fontSize)}px;font-weight:${rules.title.fontWeight};line-height:${rules.title.lineHeight};color:${rules.title.color};`;
  const title = layout.titleVariant === 'poster'
    ? `<header style="margin:0 0 18px;padding:18px;background:${rules.title.color};"><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.canvas.background};"></span></header>`
    : layout.titleVariant === 'news'
      ? `<header style="margin:0 0 18px;"><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.title.color};"></span><i style="display:block;width:52%;height:9px;margin-top:10px;border-radius:999px;background:${rules.image.captionColor};opacity:.55;"></i></header>`
    : layout.titleVariant === 'card'
      ? `<header style="margin:0 0 18px;padding:14px;border-left:8px solid ${rules.heading.borderColor};background:${rules.quote.background};"><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.title.color};"></span></header>`
      : layout.titleVariant === 'label'
        ? `<header style="margin:0 0 18px;"><i style="display:block;width:64px;height:16px;margin-bottom:10px;border-radius:999px;background:${rules.heading.borderColor};"></i><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.title.color};"></span></header>`
        : layout.titleVariant === 'split'
          ? `<header style="margin:0 0 18px;padding:14px 0;border-top:5px solid ${rules.heading.borderColor};border-bottom:1px solid ${rules.divider.color};"><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.title.color};"></span></header>`
          : layout.titleVariant === 'bar'
            ? `<header style="margin:0 0 18px;padding-bottom:12px;border-bottom:3px solid ${rules.heading.borderColor};"><i style="display:block;width:54px;height:7px;margin-bottom:10px;background:${rules.heading.borderColor};"></i><span style="display:block;width:76%;height:1em;border-radius:999px;background:${rules.title.color};"></span></header>`
            : `<h1 style="margin:0 0 18px;${titleBase}"><span style="display:block;width:76%;height:1em;border-radius:999px;background:currentColor;"></span></h1>`;
  const paragraphBase = `height:${Math.max(10, Math.round(rules.body.fontSize * 0.72))}px;margin:0 0 ${Math.max(8, Math.round(rules.body.paragraphSpacing * 0.75))}px;border-radius:999px;background:${rules.canvas.textColor};opacity:.18;`;
  const paragraph = layout.paragraphVariant === 'indent'
    ? `${paragraphBase}margin-left:22px;width:calc(100% - 22px);`
    : layout.paragraphVariant === 'rail'
      ? `${paragraphBase}padding-left:12px;border-left:3px solid ${rules.divider.color};border-radius:0;`
      : layout.paragraphVariant === 'card'
        ? `${paragraphBase}height:42px;padding:8px 10px;border-radius:6px;border:1px solid ${rules.divider.color};background:${rules.quote.background};opacity:1;`
        : layout.paragraphVariant === 'report'
          ? `${paragraphBase}padding-bottom:8px;border-bottom:1px solid ${rules.divider.color};border-radius:0;`
          : layout.paragraphVariant === 'newspaper'
            ? `${paragraphBase}height:9px;padding-top:8px;border-top:2px solid ${rules.divider.color};border-radius:0;`
            : layout.paragraphVariant === 'case-card'
              ? `${paragraphBase}position:relative;height:54px;margin-top:24px;padding:12px 12px 10px 34px;border:1px solid ${rules.heading.borderColor};border-radius:10px;background:${rules.canvas.background};opacity:1;`
            : paragraphBase;
  const heading = layout.headingVariant === 'numbered'
    ? `<h2 style="display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;"><i style="display:block;width:34px;height:34px;border-radius:50%;background:${rules.heading.borderColor};"></i><span style="display:block;width:54%;height:16px;border-radius:999px;background:${rules.heading.color};"></span></h2>`
    : layout.headingVariant === 'pill'
      ? `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;"><span style="display:block;width:46%;height:28px;border-radius:999px;border:1px solid ${rules.heading.borderColor};background:${rules.quote.background};"></span></h2>`
      : layout.headingVariant === 'underline'
        ? `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;padding-bottom:8px;border-bottom:4px solid ${rules.heading.borderColor};"><span style="display:block;width:54%;height:16px;border-radius:999px;background:${rules.heading.color};"></span></h2>`
        : layout.headingVariant === 'band'
          ? `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;padding:12px 14px;background:${rules.quote.background};border-bottom:4px solid ${rules.heading.borderColor};"><span style="display:block;width:54%;height:16px;border-radius:999px;background:${rules.heading.color};"></span></h2>`
          : layout.headingVariant === 'shadow-card'
            ? `<h2 style="position:relative;margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 14px;padding:18px 20px;background:${rules.canvas.background};box-shadow:0 8px 18px rgba(15,23,42,.1);"><i style="display:inline-block;width:3px;height:20px;margin-right:14px;background:${rules.heading.borderColor};vertical-align:-5px;"></i><span style="display:inline-block;width:46%;height:16px;border-radius:999px;background:${rules.heading.color};"></span><b style="position:absolute;right:-24px;top:-10px;width:50px;height:70px;background:${rules.quote.background};z-index:-1;"></b></h2>`
            : layout.headingVariant === 'center-underline'
              ? `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 14px;text-align:center;"><span style="display:inline-block;width:46%;height:18px;border-bottom:4px solid ${rules.heading.borderColor};"></span></h2>`
          : layout.headingVariant === 'stamp'
            ? `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;"><span style="display:block;width:48%;height:28px;border:2px solid ${rules.heading.borderColor};box-shadow:4px 4px 0 ${rules.quote.background};"></span></h2>`
            : `<h2 style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0 10px;padding-left:12px;border-left:5px solid ${rules.heading.borderColor};font-size:${Math.max(18, rules.heading.fontSize)}px;line-height:1.25;color:${rules.heading.color};font-weight:800;"><span style="display:block;width:54%;height:.9em;border-radius:999px;background:currentColor;"></span></h2>`;
  const quote = layout.quoteVariant === 'bubble'
    ? `margin:${Math.max(14, rules.body.paragraphSpacing)}px 0;padding:14px 16px;border-radius:18px 18px 18px 4px;background:${rules.quote.background};box-shadow:inset 0 0 0 1px ${rules.quote.borderColor};`
    : layout.quoteVariant === 'outline'
      ? `margin:${Math.max(14, rules.body.paragraphSpacing)}px 0;padding:14px 16px;border-top:1px solid ${rules.quote.borderColor};border-bottom:1px solid ${rules.quote.borderColor};`
      : layout.quoteVariant === 'card'
        ? `margin:${Math.max(14, rules.body.paragraphSpacing)}px 0;padding:14px 16px;border:1px solid ${rules.quote.borderColor};background:${rules.quote.background};`
        : `margin:${Math.max(14, rules.body.paragraphSpacing)}px 0;padding:14px 16px;border-left:6px solid ${rules.quote.borderColor};background:${rules.quote.background};`;
  const imageFrame = layout.imageVariant === 'poster'
    ? `padding:12px;background:${rules.title.color};`
    : layout.imageVariant === 'framed'
      ? `padding:10px;border:1px solid ${rules.divider.color};background:${rules.quote.background};`
      : layout.imageVariant === 'cutout'
        ? `padding-bottom:10px;border-bottom:5px solid ${rules.heading.borderColor};`
        : '';
  const imageShadow = layout.imageVariant === 'shadow' ? 'box-shadow:0 16px 28px rgba(15,23,42,.16);' : '';
  const imageMargin = layout.imageVariant === 'bleed' ? `${rules.image.spacing}px -18px` : `${rules.image.spacing}px 0`;
  const image = `<figure style="height:${layout.imageVariant === 'framed' || layout.imageVariant === 'poster' ? 138 : 118}px;margin:${imageMargin};${imageFrame}"><div style="height:100%;border-radius:${rules.image.borderRadius}px;background:linear-gradient(135deg,${rules.quote.background},${rules.divider.color});border:1px solid ${rules.divider.color};${imageShadow}"></div></figure>`;
  const divider = layout.dividerVariant === 'dots'
    ? `<div style="margin:${Math.max(12, rules.body.paragraphSpacing)}px 0;text-align:center;color:${rules.divider.color};font-size:22px;">•••</div>`
    : layout.dividerVariant === 'label'
      ? `<div style="display:flex;align-items:center;gap:10px;margin:${Math.max(12, rules.body.paragraphSpacing)}px 0;"><i style="height:1px;flex:1;background:${rules.divider.color};"></i><span style="width:56px;height:12px;border-radius:999px;background:${rules.divider.color};"></span><i style="height:1px;flex:1;background:${rules.divider.color};"></i></div>`
      : `<hr style="border:0;border-top:${rules.divider.thickness}px solid ${rules.divider.color};margin:${Math.max(12, rules.body.paragraphSpacing)}px 0;">`;
  const lead = layout.leadVariant === 'card'
    ? `<p style="${paragraph}width:92%;height:48px;border-radius:0;background:${rules.quote.background};opacity:1;border:1px solid ${rules.divider.color};"></p>`
    : layout.leadVariant === 'stripe'
      ? `<p style="${paragraph}width:92%;padding-left:14px;border-left:5px solid ${rules.heading.borderColor};"></p>`
      : layout.leadVariant === 'kicker'
        ? `<p style="${paragraph}width:92%;"><i style="float:left;width:34px;height:34px;margin-right:8px;background:${rules.heading.borderColor};"></i></p>`
        : `<p style="${paragraph}width:92%;"></p>`;
  const tags = layout.tagVariant === 'none' ? ''
    : `<div style="display:flex;gap:6px;margin:0 0 14px;${layout.tagVariant === 'rail' ? `padding-left:9px;border-left:3px solid ${rules.heading.borderColor};` : ''}">${[46, 58, 38].map((width) => `<span style="display:block;width:${width}px;height:14px;border-radius:${layout.tagVariant === 'mono' ? 0 : 999}px;border:1px solid ${rules.divider.color};background:${layout.tagVariant === 'chips' ? rules.quote.background : rules.canvas.background};"></span>`).join('')}</div>`;
  const toc = layout.tocVariant === 'none' ? ''
    : `<nav style="margin:0 0 16px;padding:${layout.tocVariant === 'card' ? '12px' : '0'};background:${layout.tocVariant === 'card' ? rules.quote.background : 'transparent'};border:${layout.tocVariant === 'card' ? `1px solid ${rules.divider.color}` : '0'};"><i style="display:block;width:48px;height:11px;margin-bottom:8px;background:${rules.title.color};opacity:.75;"></i>${[72, 58, 66].map((width) => `<p style="display:grid;grid-template-columns:24px 1fr;gap:7px;margin:0 0 6px;"><b style="height:10px;background:${rules.heading.borderColor};opacity:.75;"></b><span style="height:10px;width:${width}%;border-radius:999px;background:${rules.canvas.textColor};opacity:.18;"></span></p>`).join('')}</nav>`;
  const list = layout.listVariant === 'plain' ? ''
    : `<ul style="display:grid;gap:${layout.listVariant === 'spaced' ? 9 : 5}px;margin:0 0 14px;padding-left:${layout.listVariant === 'check' ? 0 : 18}px;list-style:${layout.listVariant === 'check' ? 'none' : 'disc'};">${[68, 78, 52].map((width) => `<li style="display:${layout.listVariant === 'check' ? 'grid' : 'list-item'};grid-template-columns:16px 1fr;gap:7px;"><i style="display:${layout.listVariant === 'check' ? 'block' : 'none'};width:16px;height:16px;border-radius:50%;background:${rules.heading.borderColor};"></i><span style="display:block;width:${width}%;height:10px;border-radius:999px;background:${rules.canvas.textColor};opacity:${layout.listVariant === 'bold' ? .34 : .18};"></span></li>`).join('')}</ul>`;
  const inlineAccent = layout.inlineVariant === 'dual' ? '#4f68a8' : layout.inlineVariant === 'mono' ? rules.canvas.textColor : rules.heading.borderColor;
  const inlineMarks = layout.inlineVariant === 'plain' ? ''
    : `<p style="display:flex;align-items:center;gap:7px;margin:0 0 12px;"><b style="display:block;width:34%;height:11px;border-radius:${layout.inlineVariant === 'marker' ? 0 : 999}px;background:${rules.heading.borderColor};opacity:.82;"></b><code style="display:block;width:24%;height:16px;border-radius:4px;background:${rules.quote.background};border:1px solid ${rules.divider.color};box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);"></code><i style="display:block;width:18%;height:10px;border-radius:999px;background:${inlineAccent};opacity:.76;"></i></p>`;
  const link = layout.linkVariant === 'plain' ? ''
    : `<p style="margin:0 0 12px;"><span style="display:inline-block;width:54%;height:11px;border-bottom:${layout.linkVariant === 'accent' ? `2px solid ${rules.heading.borderColor}` : 0};border-radius:${layout.linkVariant === 'pill' ? 999 : 0}px;background:${layout.linkVariant === 'pill' ? rules.quote.background : rules.heading.color};opacity:${layout.linkVariant === 'pill' ? 1 : .7};"></span></p>`;
  const caseCard = layout.paragraphVariant === 'case-card'
    ? `<p style="${paragraph}width:88%;"><b style="position:absolute;left:18px;top:-24px;padding:0 5px;background:${rules.canvas.background};color:${rules.heading.borderColor};font-size:28px;line-height:1;font-weight:900;">1</b><i style="position:absolute;left:18px;top:-3px;width:7px;height:7px;border-radius:50%;background:#f6c23e;"></i><span style="position:absolute;left:70px;right:10px;top:-1px;height:1px;background:${rules.heading.borderColor};"></span></p>`
    : `<p style="${paragraph}width:68%;"></p>`;
  const article = `<article data-layout-thumbnail="${template.id}" style="${shell}">
    ${title}
    ${tags}
    ${toc}
    ${image}
    ${heading}
    ${lead}${caseCard}
    ${list}
    ${inlineMarks}
    ${link}
    <blockquote style="${quote}"><i style="display:block;width:82%;height:10px;margin-bottom:8px;border-radius:999px;background:${rules.canvas.textColor};opacity:.24;"></i><i style="display:block;width:46%;height:10px;border-radius:999px;background:${rules.canvas.textColor};opacity:.18;"></i></blockquote>
    ${divider}
    <p style="${paragraph}width:80%;"></p><p style="${paragraph}width:58%;"></p>
  </article>`;
  return `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;-ms-overflow-style:none;scrollbar-width:none;background:${rules.canvas.background};}body::-webkit-scrollbar{display:none}</style></head><body>${article}</body></html>`;
}

function hydratePreviewHtml(html: string, assetSources: Map<string, string>) {
  const parsed = previewDocument(html);
  parsed.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((node) => {
    const assetId = node.dataset.assetId;
    const image = node.matches('img') ? node as HTMLImageElement : node.querySelector('img');
    if (assetId && image && assetSources.has(assetId)) image.src = assetSources.get(assetId) as string;
  });
  return parsed.body.innerHTML;
}

type LayoutAddonPosition = 'intro' | 'outro';
type LayoutAddon = { enabled: boolean; label: string; title: string; body: string; imageAssetId?: string | null; template?: 'CARD' | 'MINIMAL' | 'BANNER' };
type LayoutAddons = Record<LayoutAddonPosition, LayoutAddon>;

const emptyLayoutAddons: LayoutAddons = {
  intro: { enabled: false, label: '开篇', title: '', body: '' },
  outro: { enabled: false, label: '结尾', title: '', body: '' },
};

function normalizeLayoutAddon(value: unknown, fallback: LayoutAddon): LayoutAddon {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const source = value as Partial<LayoutAddon>;
  return {
    enabled: Boolean(source.enabled),
    label: String(source.label ?? fallback.label).slice(0, 24),
    title: String(source.title ?? '').slice(0, 80),
    body: String(source.body ?? '').slice(0, 500),
    imageAssetId: typeof source.imageAssetId === 'string' ? source.imageAssetId : null,
    template: source.template === 'MINIMAL' || source.template === 'BANNER' ? source.template : fallback.template ?? 'CARD',
  };
}

function reanchorVisualPlan(visualPlan: Record<string, unknown>, body: string) {
  const paragraphs = String(body ?? '').split(/\r?\n\s*\r?\n/).map((value) => value.trim()).filter(Boolean);
  const plan = Array.isArray(visualPlan.plan) ? visualPlan.plan : [];
  return { ...visualPlan, plan: plan.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const value = item as Record<string, unknown>;
    if (value.role === 'COVER' || value.role === 'MAIN') return value;
    const excerpt = String(value.sourceExcerpt ?? '').trim();
    const placement = String(value.placement ?? '').trim();
    const index = paragraphs.findIndex((paragraph) => (excerpt && paragraph.includes(excerpt)) || (placement && paragraph.includes(placement)));
    return index >= 0 ? { ...value, insertion: { paragraphIndex: index + 1, position: 'AFTER_PARAGRAPH' } } : value;
  }) };
}

function layoutAddonsFromDraft(draft: ContentDraft): LayoutAddons {
  const visualPlan = draft.visualPlan as { layoutAddons?: Partial<LayoutAddons> };
  return {
    intro: normalizeLayoutAddon(visualPlan.layoutAddons?.intro, emptyLayoutAddons.intro),
    outro: normalizeLayoutAddon(visualPlan.layoutAddons?.outro, emptyLayoutAddons.outro),
  };
}

export function LayoutWorkspace({ draft, onDraftChange, onComplete, onEditCopy, onEditVisual }: {
  draft: ContentDraft;
  onDraftChange: (draft: ContentDraft) => void;
  onComplete: (result: { draft: ContentDraft; version: ContentDraftVersion }) => void;
  onEditCopy: () => void;
  onEditVisual: () => void;
}) {
  const [templates, setTemplates] = useState<WechatLayoutTemplate[]>([]);
  const [previews, setPreviews] = useState<Record<string, WechatLayoutPreview | undefined>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<WechatLayoutPreview | undefined>();
  const [layoutAddons, setLayoutAddons] = useState<LayoutAddons>(() => layoutAddonsFromDraft(draft));
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>('load');
  const [addonSaving, setAddonSaving] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [designPolicy, setDesignPolicy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [editingTitle, setEditingTitle] = useState(draft.title);
  const [editingBody, setEditingBody] = useState(draft.body);
  const [contentSaving, setContentSaving] = useState(false);
  const [assetPickerPosition, setAssetPickerPosition] = useState<LayoutAddonPosition | null>(null);
  const [addonImageSources, setAddonImageSources] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<TemplateNotice>(null);
  const assetSourcesRef = useRef(new Map<string, string>());
  const requestIdRef = useRef(0);

  const selectedTemplate = useMemo(() => templates.find(({ id }) => id === selectedTemplateId) ?? null, [selectedTemplateId, templates]);
  const layoutAddonsDirty = JSON.stringify(layoutAddons) !== JSON.stringify(layoutAddonsFromDraft(draft));
  const requestPreview = (template: WechatLayoutTemplate) => webWechatTemplates.preview(template.id, draft.id);
  const isCurrentRequest = (requestId: number) => requestIdRef.current === requestId;

  const loadTemplates = async (preferredTemplateId?: string, requestId = ++requestIdRef.current) => {
    const result = await webWechatTemplates.list();
    if (!isCurrentRequest(requestId)) return;
    const selected = result.templates.find(({ id }) => id === preferredTemplateId)
      ?? result.templates.find(({ currentVersionId }) => currentVersionId === draft.layoutTemplateVersionId)
      ?? result.templates[0]
      ?? null;
    const loaded = await Promise.allSettled(result.templates.map(async (template) => [template.id, await requestPreview(template)] as const));
    if (!isCurrentRequest(requestId)) return;
    const rawPreviews = new Map(loaded.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []));
    const thumbnailPreviews = Object.fromEntries(result.templates.map((template) => {
      const preview = rawPreviews.get(template.id);
      return [template.id, {
        templateId: template.id,
        templateVersionId: template.currentVersionId,
        draftId: draft.id,
        checks: preview?.checks ?? [],
        html: thumbnailPreviewHtml(template),
      }];
    }));
    setTemplates(result.templates);
    setPreviews(thumbnailPreviews);
    setSelectedTemplateId(selected?.id ?? null);
    setDesignPolicy(null);
    const selectedRaw = selected ? rawPreviews.get(selected.id) : undefined;
    setSelectedPreview(selectedRaw ? { ...selectedRaw, html: hydratePreviewHtml(selectedRaw.html, assetSourcesRef.current) } : undefined);
    if (loaded.some(({ status }) => status === 'rejected')) setNotice({ tone: 'error', message: '部分模板预览加载失败，请刷新后重试。' });
  };

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const objectUrls: string[] = [];
    setBusyTemplateId('load');
    setNotice(null);
    setSelectedPreview(undefined);
    void Promise.allSettled(draft.assets.map(async ({ assetId }) => {
      const source = URL.createObjectURL(await webAssets.content(assetId));
      objectUrls.push(source);
      return [assetId, source] as const;
    })).then(async (assets) => {
      if (!isCurrentRequest(requestId)) return;
      assetSourcesRef.current = new Map(assets.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []));
      if (assets.some(({ status }) => status === 'rejected')) setNotice({ tone: 'error', message: '部分草稿图片预览加载失败。' });
      await loadTemplates(undefined, requestId);
    }).catch((error) => { if (isCurrentRequest(requestId)) setNotice(noticeFor(error, 'load')); })
      .finally(() => { if (isCurrentRequest(requestId)) setBusyTemplateId(null); });
    return () => {
      if (isCurrentRequest(requestId)) requestIdRef.current += 1;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      assetSourcesRef.current = new Map();
    };
  }, [draft.id, draft.assets.map(({ assetId }) => assetId).join('|')]);

  useEffect(() => {
    setLayoutAddons(layoutAddonsFromDraft(draft));
    setEditingTitle(draft.title);
    setEditingBody(draft.body);
  }, [draft.id, draft.title, draft.body, JSON.stringify((draft.visualPlan as { layoutAddons?: unknown }).layoutAddons ?? {})]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    const assetIds = [layoutAddons.intro.imageAssetId, layoutAddons.outro.imageAssetId].filter((id): id is string => Boolean(id));
    setAddonImageSources({});
    void Promise.all(assetIds.map(async (assetId) => {
      const url = URL.createObjectURL(await webAssets.content(assetId));
      if (!active) {
        URL.revokeObjectURL(url);
        return null;
      }
      urls.push(url);
      return [assetId, url] as const;
    })).then((entries) => {
      if (active) setAddonImageSources(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      setAddonImageSources({});
    };
  }, [layoutAddons.intro.imageAssetId, layoutAddons.outro.imageAssetId]);

  const saveContentEdits = async () => {
    if (!editingBody.trim()) return;
    setContentSaving(true);
    setNotice(null);
    try {
      const saved = await webDrafts.patch(draft.id, { revision: draft.revision, title: editingTitle.trim(), body: editingBody, visualPlan: reanchorVisualPlan(draft.visualPlan, editingBody) });
      onDraftChange(saved);
      setEditingContent(false);
      if (selectedTemplate) await selectTemplate(selectedTemplate);
      setNotice({ tone: 'success', message: '正文和标题已保存，排版预览已同步。' });
    } catch (error) { setNotice(noticeFor(error, 'preview')); }
    finally { setContentSaving(false); }
  };

  const updateLayoutAddon = (position: LayoutAddonPosition, patch: Partial<LayoutAddon>) => {
    setLayoutAddons((current) => ({ ...current, [position]: { ...current[position], ...patch } }));
  };

  const chooseAddonImage = async (asset: ProjectAsset) => {
    if (!assetPickerPosition) return;
    let saved = draft;
    if (!draft.assets.some(({ assetId }) => assetId === asset.id)) {
      saved = await webDrafts.replaceAssets(draft.id, { revision: draft.revision, assets: [...draft.assets.map(({ assetId, role }) => ({ assetId, role })), { assetId: asset.id, role: 'CARD' }] });
      onDraftChange(saved);
    }
    const nextAddons = { ...layoutAddons, [assetPickerPosition]: { ...layoutAddons[assetPickerPosition], imageAssetId: asset.id } };
    setLayoutAddons(nextAddons);
    const updated = await webDrafts.patch(saved.id, { revision: saved.revision, visualPlan: { ...(saved.visualPlan ?? {}), layoutAddons: nextAddons } });
    onDraftChange(updated);
    setAssetPickerPosition(null);
  };

  const saveLayoutAddons = async () => {
    setAddonSaving(true);
    setNotice(null);
    try {
      const saved = await webDrafts.patch(draft.id, {
        revision: draft.revision,
        visualPlan: { ...(draft.visualPlan ?? {}), layoutAddons },
      });
      onDraftChange(saved);
      return saved;
    } catch (error) {
      setNotice(noticeFor(error, 'complete'));
      throw error;
    } finally {
      setAddonSaving(false);
    }
  };

  const applyLayoutAddons = async () => {
    await saveLayoutAddons();
    if (selectedTemplate) await selectTemplate(selectedTemplate);
  };

  const designLayout = async () => {
    const requestId = ++requestIdRef.current;
    setDesigning(true);
    setBusyTemplateId('design');
    setNotice(null);
    setDesignPolicy(null);
    try {
      const currentDraft = layoutAddonsDirty ? await saveLayoutAddons() : draft;
      const instruction = designInstruction.trim();
      const result = await webDrafts.designLayout(currentDraft.id, {
        ...(selectedTemplateId ? { templateId: selectedTemplateId } : {}),
        ...(selectedPreview?.templateVersionId ? { templateVersionId: selectedPreview.templateVersionId } : {}),
        ...(instruction ? { instruction } : {}),
      });
      if (!isCurrentRequest(requestId)) return;
      onDraftChange(result.draft);
      setSelectedTemplateId(result.templateId);
      setSelectedPreview({ ...result, html: hydratePreviewHtml(result.html, assetSourcesRef.current) });
      setDesignPolicy(`实际策略：公众号智能精排（${result.policy.scope}） · ${result.policy.provider} / ${result.policy.model}`);
      setNotice({ tone: 'success', message: '智能精排已应用到预览。' });
    } catch (error) {
      if (isCurrentRequest(requestId)) setNotice(noticeFor(error, 'design'));
    } finally {
      if (isCurrentRequest(requestId)) {
        setDesigning(false);
        setBusyTemplateId(null);
      }
    }
  };

  const selectTemplate = async (template: WechatLayoutTemplate) => {
    const requestId = ++requestIdRef.current;
    setSelectedTemplateId(template.id);
    setSelectedPreview(undefined);
    setDesignPolicy(null);
    setBusyTemplateId(template.id);
    setNotice(null);
    try {
      const preview = await requestPreview(template);
      if (isCurrentRequest(requestId)) setSelectedPreview({ ...preview, html: hydratePreviewHtml(preview.html, assetSourcesRef.current) });
    } catch (error) { if (isCurrentRequest(requestId)) setNotice(noticeFor(error, 'preview')); }
    finally { if (isCurrentRequest(requestId)) setBusyTemplateId(null); }
  };

  const importTemplate = async (input: { name: string; url: string }) => {
    setBusyTemplateId('import');
    setNotice(null);
    try {
      const created = await webWechatTemplates.import(input);
      await loadTemplates(created.id);
      setNotice({ tone: 'success', message: '公众号模板已保存。' });
    } catch (error) { setNotice(noticeFor(error, 'import')); throw error; }
    finally { setBusyTemplateId(null); }
  };

  const duplicateTemplate = async (template: WechatLayoutTemplate) => {
    setBusyTemplateId(template.id);
    setNotice(null);
    try {
      const duplicated = await webWechatTemplates.duplicate(template.id, `${template.name} 副本`);
      await loadTemplates(duplicated.id);
      setNotice({ tone: 'success', message: '模板副本已创建。' });
    } catch (error) { setNotice(noticeFor(error, 'duplicate')); }
    finally { setBusyTemplateId(null); }
  };

  const removeTemplate = async (template: WechatLayoutTemplate) => {
    setBusyTemplateId(template.id);
    setNotice(null);
    try {
      await webWechatTemplates.remove(template.id);
      await loadTemplates(selectedTemplateId === template.id ? undefined : selectedTemplateId ?? undefined);
      setNotice({ tone: 'success', message: '模板已删除。' });
    } catch (error) { setNotice(noticeFor(error, 'remove')); }
    finally { setBusyTemplateId(null); }
  };

  const complete = async () => {
    if (!selectedTemplate || !selectedPreview) return;
    setSaving(true);
    setNotice(null);
    try {
      let currentDraft = layoutAddonsDirty ? await saveLayoutAddons() : draft;
      const templateVersionId = selectedPreview.templateVersionId;
      const workingDraft = currentDraft.layoutTemplateVersionId === templateVersionId
        ? currentDraft
        : await webDrafts.patch(currentDraft.id, { revision: currentDraft.revision, layoutTemplateVersionId: templateVersionId });
      onDraftChange(workingDraft);
      const result = await webDrafts.complete(workingDraft.id, workingDraft.revision);
      onDraftChange(result.draft);
      onComplete(result);
    } catch (error) { setNotice(noticeFor(error, 'complete')); }
    finally { setSaving(false); }
  };

  return <><section className="wechat-layout-workspace">
    {editingContent && <section className="wechat-layout-inline-editor" aria-label="排版内容编辑"><label><span>标题</span><input value={editingTitle} maxLength={200} onChange={(event) => setEditingTitle(event.target.value)}/></label><label><span>正文</span><textarea value={editingBody} rows={12} onChange={(event) => setEditingBody(event.target.value)}/></label><div><button className="button" type="button" onClick={() => setEditingContent(false)}>取消</button><button className="button primary" type="button" disabled={contentSaving || !editingBody.trim()} onClick={() => void saveContentEdits()}>{contentSaving ? <LoaderCircle size={15}/> : <Check size={15}/>}保存并刷新排版</button></div></section>}
    <header className="delivery-workspace-head">
      <div><h2>公众号排版</h2><span className="chip blue">母稿</span></div>
      <div className="layout-edit-actions">
        <button className="button" type="button" onClick={() => setEditingContent((value) => !value)}><Edit3 size={15}/>排版内编辑</button>
        <button className="button" type="button" onClick={onEditCopy}><Edit3 size={15}/>编辑正文</button>
        <button className="button" type="button" onClick={onEditVisual}><Edit3 size={15}/>编辑配图</button>
        <button className="button" type="button" disabled={busyTemplateId !== null} onClick={() => { setBusyTemplateId('load'); void loadTemplates(selectedTemplateId ?? undefined).catch((error) => setNotice(noticeFor(error, 'load'))).finally(() => setBusyTemplateId(null)); }}><RefreshCw size={15}/>刷新模板</button>
      </div>
    </header>

    <div className="wechat-layout-grid">
      <WechatLayoutTemplatePicker templates={templates} previews={previews} selectedTemplateId={selectedTemplateId} busyTemplateId={busyTemplateId} notice={notice} onSelect={(template) => void selectTemplate(template)} onImport={importTemplate} onDuplicate={duplicateTemplate} onRemove={removeTemplate}/>
      <section className="wechat-layout-preview" aria-label="公众号排版预览">
        <header><div><b>{selectedTemplate?.name ?? '未选择模板'}</b>{selectedPreview?.checks.map((check) => <span className={`wechat-layout-check ${check.level.toLowerCase()}`} key={check.code}>{check.message}</span>)}</div><button className="button primary" type="button" disabled={designing || busyTemplateId !== null || !draft.body.trim()} onClick={() => void designLayout()}>{designing ? <LoaderCircle size={15}/> : <Sparkles size={15}/>}精排当前模板</button></header>
        <section className="wechat-layout-addons" aria-label="个性开头和结尾">
          <div className="wechat-layout-design-panel">
            <label><span>本次精排要求（可选）</span><input value={designInstruction} maxLength={240} placeholder="只影响当前模板，例如：案例段落做卡片，关键词更醒目" onChange={(event) => setDesignInstruction(event.target.value)}/></label>
            <small>{designPolicy ?? (selectedTemplate ? `当前模板：${selectedTemplate.name}，切换模板不会自动套用本次精排` : '先选择模板，再对当前模板精排')}</small>
          </div>
          <div className="layout-addon-image-previews" aria-label="个性图片预览">
            {(['intro', 'outro'] as const).map((position) => {
              const assetId = layoutAddons[position].imageAssetId;
              const source = assetId ? addonImageSources[assetId] : undefined;
              return source ? <figure key={position}><img src={source} alt={`${position === 'intro' ? '开头' : '结尾'}图片预览`} /><figcaption>{position === 'intro' ? '开头图片' : '结尾图片'}</figcaption></figure> : null;
            })}
          </div>
          {(['intro', 'outro'] as const).map((position) => {
            const addon = layoutAddons[position];
            return <fieldset key={position}>
              <legend><label><input type="checkbox" checked={addon.enabled} onChange={(event) => updateLayoutAddon(position, { enabled: event.target.checked })}/>{position === 'intro' ? '个性开头' : '个性结尾'}</label></legend>
              <div>
                <label className="layout-addon-template"><span>模块模板</span><select value={addon.template ?? 'CARD'} onChange={(event) => updateLayoutAddon(position, { template: event.target.value as LayoutAddon['template'] })}><option value="CARD">卡片</option><option value="MINIMAL">简洁</option><option value="BANNER">横幅</option></select></label>
                <div className="layout-addon-image-row"><span>配图</span><button className="text-button" type="button" onClick={() => setAssetPickerPosition(position)}>{addon.imageAssetId ? '更换图片' : '上传或从素材库选择'}</button>{addon.imageAssetId && <button className="text-button danger" type="button" onClick={() => updateLayoutAddon(position, { imageAssetId: null })}>移除</button>}</div>
                <input aria-label={`${position === 'intro' ? '开头' : '结尾'}标签`} value={addon.label} maxLength={24} onChange={(event) => updateLayoutAddon(position, { label: event.target.value })}/>
                <input aria-label={`${position === 'intro' ? '开头' : '结尾'}标题`} value={addon.title} maxLength={80} placeholder={position === 'intro' ? '一句个人化开场' : '一句收束或行动提醒'} onChange={(event) => updateLayoutAddon(position, { title: event.target.value })}/>
                <textarea aria-label={`${position === 'intro' ? '开头' : '结尾'}正文`} value={addon.body} maxLength={500} placeholder={position === 'intro' ? '例如：今天这篇先把结论讲透，再给你可执行的判断框架。' : '例如：觉得有启发，可以收藏，下一篇继续拆一个实操案例。'} onChange={(event) => updateLayoutAddon(position, { body: event.target.value })}/>
              </div>
            </fieldset>;
          })}
          <footer><span>{layoutAddonsDirty ? '有未应用的个性元素' : '个性元素已同步到草稿'}</span><button className="button" type="button" disabled={!layoutAddonsDirty || addonSaving || busyTemplateId !== null} onClick={() => void applyLayoutAddons()}>{addonSaving ? <LoaderCircle size={15}/> : <Check size={15}/>}应用并刷新预览</button></footer>
        </section>
        {selectedPreview ? <iframe className="wechat-layout-preview-frame" title="公众号排版效果" sandbox="allow-same-origin" srcDoc={selectedPreview.html}/> : <div className="wechat-layout-preview-empty">{busyTemplateId ? <LoaderCircle size={22}/> : <FileText size={22}/>}<b>{busyTemplateId ? '正在生成预览' : '请选择排版模板'}</b></div>}
      </section>
    </div>

    <footer className="delivery-workspace-footer">
      <span>{selectedTemplate ? `当前模板：${selectedTemplate.name}` : '尚未选择模板'}</span>
      <button className="button primary" type="button" disabled={!selectedTemplate || !selectedPreview || saving || busyTemplateId !== null} onClick={() => void complete()}>{saving ? <LoaderCircle size={16}/> : <Check size={16}/>}保存公众号草稿</button>
    </footer>
  </section>{assetPickerPosition && <AssetPickerDialog projectId={draft.projectId} role="VISUAL" scope="PROJECT" platforms={['WECHAT']} allowUpload imageOnly onLinked={(asset) => void chooseAddonImage(asset)} onClose={() => setAssetPickerPosition(null)}/>}</>;
}
