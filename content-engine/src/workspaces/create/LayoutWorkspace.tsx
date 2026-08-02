import { Check, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WebApiError, webAssets, webDrafts, webWechatTemplates } from '../../data/webApi';
import type { ContentDraft, ContentDraftVersion, WechatLayoutPreview, WechatLayoutTemplate } from '../../domain/content-drafts';
import { WechatLayoutTemplatePicker, type TemplateNotice } from './WechatLayoutTemplatePicker';

function noticeFor(error: unknown, action: 'load' | 'import' | 'duplicate' | 'archive' | 'preview' | 'complete'): TemplateNotice {
  if (error instanceof WebApiError) {
    if (error.code === 'TASK_POLICY_REQUIRED') return { tone: 'error', message: '缺少“公众号模板分析”任务策略，请先在模型与 API 中配置。' };
    if (error.code === 'LAYOUT_TEMPLATE_RULES_INVALID') return { tone: 'error', message: '模型返回的排版规则不合规，模板没有保存。' };
    if (error.code === 'LAYOUT_TEMPLATE_IN_USE') return { tone: 'error', message: '该模板正在被草稿或历史版本使用，不能归档。' };
    if (error.code === 'LAYOUT_TEMPLATE_NAME_CONFLICT') return { tone: 'error', message: '已有同名模板，请换一个名称。' };
    if (error.code === 'LAYOUT_TEMPLATE_SOURCE_INVALID' || error.code === 'LAYOUT_TEMPLATE_SOURCE_UNSUPPORTED') return { tone: 'error', message: '链接不是可读取的公众号文章，请检查后重试。' };
    return { tone: 'error', message: error.message };
  }
  const messages = {
    load: '读取排版模板失败。',
    import: '导入公众号模板失败。',
    duplicate: '复制模板失败。',
    archive: '归档模板失败。',
    preview: '生成排版预览失败。',
    complete: '保存公众号草稿失败。',
  };
  return { tone: 'error', message: error instanceof Error ? error.message : messages[action] };
}

function previewDocument(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function thumbnailPreviewHtml(html: string) {
  const parsed = previewDocument(html);
  parsed.querySelectorAll('figure[data-asset-id]').forEach((figure) => {
    figure.querySelector('img')?.remove();
    figure.setAttribute('aria-hidden', 'true');
    figure.setAttribute('style', `${figure.getAttribute('style') ?? ''};min-height:120px;background:#edf1f6`);
  });
  return parsed.body.innerHTML;
}

function hydratePreviewHtml(html: string, assetSources: Map<string, string>) {
  const parsed = previewDocument(html);
  parsed.querySelectorAll<HTMLElement>('figure[data-asset-id]').forEach((figure) => {
    const assetId = figure.dataset.assetId;
    const image = figure.querySelector('img');
    if (assetId && image && assetSources.has(assetId)) image.src = assetSources.get(assetId) as string;
  });
  return parsed.body.innerHTML;
}

export function LayoutWorkspace({ draft, onDraftChange, onComplete }: {
  draft: ContentDraft;
  onDraftChange: (draft: ContentDraft) => void;
  onComplete: (result: { draft: ContentDraft; version: ContentDraftVersion }) => void;
}) {
  const [templates, setTemplates] = useState<WechatLayoutTemplate[]>([]);
  const [previews, setPreviews] = useState<Record<string, WechatLayoutPreview | undefined>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<WechatLayoutPreview | undefined>();
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>('load');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<TemplateNotice>(null);
  const assetSourcesRef = useRef(new Map<string, string>());
  const requestIdRef = useRef(0);

  const selectedTemplate = useMemo(() => templates.find(({ id }) => id === selectedTemplateId) ?? null, [selectedTemplateId, templates]);
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
    const thumbnailPreviews = Object.fromEntries([...rawPreviews].map(([id, preview]) => [id, { ...preview, html: thumbnailPreviewHtml(preview.html) }]));
    setTemplates(result.templates);
    setPreviews(thumbnailPreviews);
    setSelectedTemplateId(selected?.id ?? null);
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

  const selectTemplate = async (template: WechatLayoutTemplate) => {
    const requestId = ++requestIdRef.current;
    setSelectedTemplateId(template.id);
    setSelectedPreview(undefined);
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

  const archiveTemplate = async (template: WechatLayoutTemplate) => {
    setBusyTemplateId(template.id);
    setNotice(null);
    try {
      await webWechatTemplates.archive(template.id);
      await loadTemplates(selectedTemplateId === template.id ? undefined : selectedTemplateId ?? undefined);
      setNotice({ tone: 'success', message: '模板已归档。' });
    } catch (error) { setNotice(noticeFor(error, 'archive')); }
    finally { setBusyTemplateId(null); }
  };

  const complete = async () => {
    if (!selectedTemplate || !selectedPreview) return;
    setSaving(true);
    setNotice(null);
    try {
      const templateVersionId = selectedPreview.templateVersionId;
      const workingDraft = draft.layoutTemplateVersionId === templateVersionId
        ? draft
        : await webDrafts.patch(draft.id, { revision: draft.revision, layoutTemplateVersionId: templateVersionId });
      onDraftChange(workingDraft);
      const result = await webDrafts.complete(workingDraft.id, workingDraft.revision);
      onDraftChange(result.draft);
      onComplete(result);
    } catch (error) { setNotice(noticeFor(error, 'complete')); }
    finally { setSaving(false); }
  };

  return <section className="wechat-layout-workspace">
    <header className="delivery-workspace-head">
      <div><h2>公众号排版</h2><span className="chip blue">母稿</span></div>
      <button className="button" type="button" disabled={busyTemplateId !== null} onClick={() => { setBusyTemplateId('load'); void loadTemplates(selectedTemplateId ?? undefined).catch((error) => setNotice(noticeFor(error, 'load'))).finally(() => setBusyTemplateId(null)); }}><RefreshCw size={15}/>刷新模板</button>
    </header>

    <div className="wechat-layout-grid">
      <WechatLayoutTemplatePicker templates={templates} previews={previews} selectedTemplateId={selectedTemplateId} busyTemplateId={busyTemplateId} notice={notice} onSelect={(template) => void selectTemplate(template)} onImport={importTemplate} onDuplicate={duplicateTemplate} onArchive={archiveTemplate}/>
      <section className="wechat-layout-preview" aria-label="公众号排版预览">
        <header><div><b>{selectedTemplate?.name ?? '未选择模板'}</b>{selectedPreview?.checks.map((check) => <span className={`wechat-layout-check ${check.level.toLowerCase()}`} key={check.code}>{check.message}</span>)}</div></header>
        {selectedPreview ? <iframe className="wechat-layout-preview-frame" title="公众号排版效果" sandbox="allow-same-origin" srcDoc={selectedPreview.html}/> : <div className="wechat-layout-preview-empty">{busyTemplateId ? <LoaderCircle size={22}/> : <FileText size={22}/>}<b>{busyTemplateId ? '正在生成预览' : '请选择排版模板'}</b></div>}
      </section>
    </div>

    <footer className="delivery-workspace-footer">
      <span>{selectedTemplate ? `当前模板：${selectedTemplate.name}` : '尚未选择模板'}</span>
      <button className="button primary" type="button" disabled={!selectedTemplate || !selectedPreview || saving || busyTemplateId !== null} onClick={() => void complete()}>{saving ? <LoaderCircle size={16}/> : <Check size={16}/>}保存公众号草稿</button>
    </footer>
  </section>;
}
