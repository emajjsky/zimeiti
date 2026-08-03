import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, CircleAlert, Crop, Eye, Image as ImageIcon, ImagePlus, LoaderCircle, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetPickerDialog } from '../../components/assets/AssetPickerDialog';
import { AssetPreviewDialog } from '../../components/assets/AssetPreviewDialog';
import { webAssets, webCreative, webDrafts, webModels } from '../../data/webApi';
import type { WorkspaceAsset } from '../../domain/assets';
import type { ContentDraft, DraftAsset, DraftPlatform } from '../../domain/content-drafts';
import type { ModelTaskPolicy } from '../../domain/integrations';
import { draftSourceState, moveDraftAsset, normalizeDraftAssets, PLATFORM_DRAFT_IMAGE_LIMIT, removeDraftAsset } from '../../domain/platform-draft-editor.mjs';

type SocialPlatform = Exclude<DraftPlatform, 'WECHAT'>;
type CropRatio = 'ORIGINAL' | '3:4' | '1:1';
type ImageOperation = 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE';

const platformNames: Record<SocialPlatform, string> = { XIAOHONGSHU: '小红书', WEIBO: '微博' };
const ratioNames: Record<CropRatio, string> = { ORIGINAL: '原图', '3:4': '3:4', '1:1': '1:1' };

function editorPlan(draft: ContentDraft) {
  const value = draft.visualPlan.platformEditor;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cropRatios(draft: ContentDraft) {
  const value = editorPlan(draft).cropRatios;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, CropRatio> : {};
}

function generatedAssetIds(draft: ContentDraft) {
  const value = editorPlan(draft).generatedAssetIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function imageSuggestions(draft: ContentDraft) {
  const adaptation = draft.visualPlan.adaptation;
  if (!adaptation || typeof adaptation !== 'object' || Array.isArray(adaptation)) return [];
  const suggestions = (adaptation as Record<string, unknown>).imageSuggestions;
  return Array.isArray(suggestions) ? suggestions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function DraftAssetThumbnail({ asset }: { asset: WorkspaceAsset }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void webAssets.content(asset.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setUrl(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id]);
  return url ? <img src={url} alt={asset.title}/> : <span><LoaderCircle size={20}/><small>读取预览</small></span>;
}

export function PlatformDraftEditor({ draft, currentSourceVersionId, onDraftChange, onBack, onOpenModelSettings }: {
  draft: ContentDraft;
  currentSourceVersionId: string | null;
  onDraftChange: (draft: ContentDraft) => void;
  onBack: () => void;
  onOpenModelSettings: () => void;
}) {
  const platform = draft.platform as SocialPlatform;
  const [workingDraft, setWorkingDraft] = useState(draft);
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [assets, setAssets] = useState<Record<string, WorkspaceAsset>>({});
  const [previewAsset, setPreviewAsset] = useState<WorkspaceAsset | null>(null);
  const [picker, setPicker] = useState<{ replaceIndex: number | null } | null>(null);
  const [imageTaskOpen, setImageTaskOpen] = useState(false);
  const [imageOperation, setImageOperation] = useState<ImageOperation>('TEXT_TO_IMAGE');
  const [imagePrompt, setImagePrompt] = useState(() => `为${platformNames[platform]}创作一张以“${draft.title || '文章核心观点'}”为主体的内容图片。画面以真实内容和视觉叙事为主，不要文字海报，不要 PPT 页面。`);
  const [referenceAssetId, setReferenceAssetId] = useState(draft.assets[0]?.assetId ?? '');
  const [policies, setPolicies] = useState<ModelTaskPolicy[]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastGenerationPolicy, setLastGenerationPolicy] = useState<{ scope: ImageOperation; provider: string; model: string } | null>(null);
  const draftRef = useRef(draft);
  const titleRef = useRef(draft.title);
  const bodyRef = useRef(draft.body);
  const savedTextRef = useRef(JSON.stringify([draft.title, draft.body]));
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (draft.id === draftRef.current.id) {
      if (draft.revision > draftRef.current.revision) { draftRef.current = draft; setWorkingDraft(draft); }
      return;
    }
    draftRef.current = draft;
    setWorkingDraft(draft); setTitle(draft.title); setBody(draft.body);
    titleRef.current = draft.title; bodyRef.current = draft.body;
    savedTextRef.current = JSON.stringify([draft.title, draft.body]);
    setError(''); setSaveState('saved'); setPicker(null); setPreviewAsset(null); setImageTaskOpen(false);
  }, [draft]);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { bodyRef.current = body; }, [body]);

  const commitDraft = useCallback((saved: ContentDraft) => {
    draftRef.current = saved;
    setWorkingDraft(saved);
    onDraftChange(saved);
    return saved;
  }, [onDraftChange]);

  const queueMutation = useCallback(<T,>(mutation: (current: ContentDraft) => Promise<T>) => {
    const task = mutationQueue.current.catch(() => undefined).then(() => mutation(draftRef.current));
    mutationQueue.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  const saveText = useCallback(async () => {
    const signature = JSON.stringify([titleRef.current, bodyRef.current]);
    if (signature === savedTextRef.current) return draftRef.current;
    setSaveState('saving'); setError('');
    try {
      const saved = await queueMutation((current) => webDrafts.patch(current.id, {
        revision: current.revision,
        title: titleRef.current,
        body: bodyRef.current,
      }));
      savedTextRef.current = JSON.stringify([saved.title, saved.body]);
      setSaveState('saved');
      return commitDraft(saved);
    } catch (reason) {
      setSaveState('error'); setError(reason instanceof Error ? reason.message : '平台草稿正文保存失败。');
      throw reason;
    }
  }, [commitDraft, queueMutation]);

  useEffect(() => {
    if (JSON.stringify([title, body]) === savedTextRef.current) return;
    const timer = window.setTimeout(() => { void saveText().catch(() => undefined); }, 650);
    return () => window.clearTimeout(timer);
  }, [body, saveText, title]);

  useEffect(() => {
    let active = true;
    const ids = workingDraft.assets.map(({ assetId }) => assetId);
    if (!ids.length) { setAssets({}); return; }
    void Promise.all(ids.map((assetId) => webAssets.get(assetId))).then((listed) => {
      if (active) setAssets(Object.fromEntries(listed.map((asset) => [asset.id, asset])));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '读取草稿图片失败。'); });
    return () => { active = false; };
  }, [workingDraft.assets.map(({ assetId }) => assetId).join('|')]);

  useEffect(() => {
    if (!imageTaskOpen || policyLoaded || policyLoading) return;
    let active = true;
    setPolicyLoading(true);
    void webModels.taskPolicies().then((listed) => { if (active) setPolicies(listed); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '读取生图任务策略失败。'); })
      .finally(() => { if (active) { setPolicyLoading(false); setPolicyLoaded(true); } });
    return () => { active = false; };
  }, [imageTaskOpen, policyLoaded]);

  const sourceState = draftSourceState(workingDraft, currentSourceVersionId);
  const activePolicy = policies.find(({ task }) => task === imageOperation);
  const ratios = cropRatios(workingDraft);
  const generatedIds = generatedAssetIds(workingDraft);
  const missingXiaohongshuImage = platform === 'XIAOHONGSHU'
    && imageSuggestions(workingDraft).some(({ needsNewImage }) => needsNewImage === true)
    && generatedIds.length === 0;

  const saveAssetOrder = async (nextAssets: Array<Pick<DraftAsset, 'assetId' | 'role'>>, linkedAsset?: WorkspaceAsset) => {
    setError(''); setSaveState('saving');
    try {
      const normalized = normalizeDraftAssets(nextAssets);
      const saved = await queueMutation((current) => webDrafts.replaceAssets(current.id, { revision: current.revision, assets: normalized }));
      if (linkedAsset) setAssets((current) => ({ ...current, [linkedAsset.id]: linkedAsset }));
      setSaveState('saved');
      const committed = commitDraft(saved);
      const retainedIds = new Set(normalized.map(({ assetId }) => assetId));
      const currentRatios = cropRatios(committed);
      const retainedRatios = Object.fromEntries(Object.entries(currentRatios).filter(([assetId]) => retainedIds.has(assetId)));
      const currentGeneratedIds = generatedAssetIds(committed);
      const retainedGeneratedIds = currentGeneratedIds.filter((assetId) => retainedIds.has(assetId));
      if (Object.keys(retainedRatios).length !== Object.keys(currentRatios).length || retainedGeneratedIds.length !== currentGeneratedIds.length) {
        return updateEditorPlan({ cropRatios: retainedRatios, generatedAssetIds: retainedGeneratedIds });
      }
      return committed;
    } catch (reason) {
      setSaveState('error'); setError(reason instanceof Error ? reason.message : '图片顺序保存失败。');
      throw reason;
    }
  };

  const updateEditorPlan = async (nextPlan: Record<string, unknown>) => {
    setError(''); setSaveState('saving');
    try {
      const saved = await queueMutation((current) => webDrafts.patch(current.id, {
        revision: current.revision,
        visualPlan: { ...current.visualPlan, platformEditor: { ...editorPlan(current), ...nextPlan } },
      }));
      setSaveState('saved');
      return commitDraft(saved);
    } catch (reason) {
      setSaveState('error'); setError(reason instanceof Error ? reason.message : '图片设置保存失败。');
      throw reason;
    }
  };

  const selectAsset = async (asset: WorkspaceAsset) => {
    const current = workingDraft.assets.map(({ assetId, role }) => ({ assetId, role }));
    const next = picker?.replaceIndex === null || picker?.replaceIndex === undefined
      ? [...current, { assetId: asset.id, role: 'BODY' as const }]
      : current.map((item, index) => index === picker.replaceIndex ? { assetId: asset.id, role: item.role } : item);
    await saveAssetOrder(next, asset);
    setPicker(null);
  };

  const changeCrop = async (assetId: string, ratio: CropRatio) => {
    await updateEditorPlan({ cropRatios: { ...cropRatios(draftRef.current), [assetId]: ratio } });
  };

  const generateImage = async () => {
    if (!activePolicy?.provider || !activePolicy.model) { setError(`请先配置 ${imageOperation} 任务策略。`); return; }
    if (imagePrompt.trim().length < 4) { setError('请填写至少 4 个字的生图要求。'); return; }
    if (workingDraft.assets.length >= PLATFORM_DRAFT_IMAGE_LIMIT) { setError(`平台草稿最多允许 ${PLATFORM_DRAFT_IMAGE_LIMIT} 张图片。`); return; }
    if (imageOperation === 'IMAGE_TO_IMAGE' && !referenceAssetId) { setError('图生图必须选择一张当前草稿图片作为参考。'); return; }
    setGenerating(true); setError(''); setLastGenerationPolicy(null);
    try {
      const result = await webCreative.generateImage(workingDraft.projectId, {
        platform,
        prompt: imagePrompt.trim(),
        size: platform === 'XIAOHONGSHU' ? '3:4' : '1:1',
        assetIds: imageOperation === 'IMAGE_TO_IMAGE' ? [referenceAssetId] : [],
      });
      const saved = await saveAssetOrder([...draftRef.current.assets, { assetId: result.projectAsset.id, role: 'BODY' }], result.projectAsset);
      const nextGeneratedIds = [...new Set([...generatedAssetIds(saved), result.projectAsset.id])];
      await updateEditorPlan({
        generatedAssetIds: nextGeneratedIds,
        cropRatios: { ...cropRatios(saved), [result.projectAsset.id]: platform === 'XIAOHONGSHU' ? '3:4' : '1:1' },
      });
      setLastGenerationPolicy(result.policy);
      setReferenceAssetId(result.projectAsset.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 生图失败。'); }
    finally { setGenerating(false); }
  };

  const leaveEditor = async () => {
    try { await saveText(); onBack(); } catch { /* 保存错误已在页面显示，留在当前编辑器。 */ }
  };

  return <section className="platform-draft-editor">
    <header className="platform-draft-editor-head">
      <button className="text-button" type="button" onClick={() => void leaveEditor()}><ArrowLeft size={16}/>完成草稿</button>
      <div><span>{platformNames[platform]} / 图文草稿</span><h2>{platformNames[platform]}草稿编辑</h2></div>
      <div className={`platform-draft-save ${saveState}`}><Save size={14}/>{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : '已保存'}</div>
    </header>

    {sourceState !== 'CURRENT' && <div className="platform-source-warning" role="alert"><CircleAlert size={18}/><div><b>{sourceState === 'STALE' ? '公众号来源版本已更新' : '没有可核对的公众号来源版本'}</b><span>此草稿不能继续编辑。返回完成草稿页，基于当前公众号版本明确重新生成。</span></div><button className="button" type="button" onClick={onBack}>返回重新生成</button></div>}
    {error && <div className="creative-stage-error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}

    <div className="platform-draft-editor-grid" aria-disabled={sourceState !== 'CURRENT'}>
      <section className="platform-copy-panel">
        <header><div><span>01 / 文字内容</span><h3>标题与正文</h3></div><small>{body.length.toLocaleString('zh-CN')} 字</small></header>
        <label><span>标题</span><input aria-label={`${platformNames[platform]}标题`} value={title} disabled={sourceState !== 'CURRENT'} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveText().catch(() => undefined)} maxLength={300}/></label>
        <label className="platform-body-field"><span>正文</span><textarea aria-label={`${platformNames[platform]}正文`} value={body} disabled={sourceState !== 'CURRENT'} onChange={(event) => setBody(event.target.value)} onBlur={() => void saveText().catch(() => undefined)} maxLength={200000}/></label>
      </section>

      <section className="platform-image-panel">
        <header><div><span>02 / 图片内容</span><h3>图片顺序与裁切</h3></div><b>{workingDraft.assets.length} / {PLATFORM_DRAFT_IMAGE_LIMIT}</b></header>
        {missingXiaohongshuImage && <div className="platform-image-task"><ImagePlus size={18}/><div><b>缺少 3:4 小红书内容图</b><span>派生策略要求补充平台图片。生图不会自动运行，确认策略后再生成。</span></div><button className="button" type="button" onClick={() => setImageTaskOpen(true)}>处理任务</button></div>}
        <div className="platform-image-list">{workingDraft.assets.length ? workingDraft.assets.map((draftAsset, index) => {
          const asset = assets[draftAsset.assetId];
          return <article className="platform-image-item" key={draftAsset.assetId}>
            <button className="platform-image-preview" type="button" disabled={!asset} onClick={() => asset && setPreviewAsset(asset)} aria-label={`预览图片 ${index + 1}`}>
              {asset ? <DraftAssetThumbnail asset={asset}/> : <span><LoaderCircle size={20}/><small>读取素材</small></span>}
              <i>{index === 0 ? '封面' : String(index + 1).padStart(2, '0')}</i>
            </button>
            <div className="platform-image-meta"><b>{asset?.title ?? '正在读取图片信息'}</b><small>{asset?.originalFilename ?? draftAsset.assetId}</small><label><Crop size={13}/><span>发布裁切</span><select aria-label={`图片 ${index + 1} 裁切比例`} value={ratios[draftAsset.assetId] ?? (platform === 'XIAOHONGSHU' ? '3:4' : 'ORIGINAL')} disabled={sourceState !== 'CURRENT'} onChange={(event) => void changeCrop(draftAsset.assetId, event.target.value as CropRatio)}>{(Object.keys(ratioNames) as CropRatio[]).map((ratio) => <option key={ratio} value={ratio}>{ratioNames[ratio]}</option>)}</select></label></div>
            <div className="platform-image-actions">
              <button className="icon-button" type="button" title="预览" aria-label={`预览第 ${index + 1} 张图片`} disabled={!asset} onClick={() => asset && setPreviewAsset(asset)}><Eye size={15}/></button>
              <button className="icon-button" type="button" title="替换" aria-label={`替换第 ${index + 1} 张图片`} disabled={sourceState !== 'CURRENT'} onClick={() => setPicker({ replaceIndex: index })}><RefreshCw size={15}/></button>
              <button className="icon-button" type="button" title="上移" aria-label={`上移第 ${index + 1} 张图片`} disabled={sourceState !== 'CURRENT' || index === 0} onClick={() => void saveAssetOrder(moveDraftAsset(workingDraft.assets, index, -1)).catch(() => undefined)}><ArrowUp size={15}/></button>
              <button className="icon-button" type="button" title="下移" aria-label={`下移第 ${index + 1} 张图片`} disabled={sourceState !== 'CURRENT' || index === workingDraft.assets.length - 1} onClick={() => void saveAssetOrder(moveDraftAsset(workingDraft.assets, index, 1)).catch(() => undefined)}><ArrowDown size={15}/></button>
              <button className="icon-button danger" type="button" title="删除" aria-label={`删除第 ${index + 1} 张图片`} disabled={sourceState !== 'CURRENT'} onClick={() => void saveAssetOrder(removeDraftAsset(workingDraft.assets, index)).catch(() => undefined)}><Trash2 size={15}/></button>
            </div>
          </article>;
        }) : <div className="platform-image-empty"><ImageIcon size={28}/><b>还没有图片</b><span>从素材库选择，或明确启动一次 AI 生图任务。</span></div>}</div>
        <footer><button className="button" type="button" disabled={sourceState !== 'CURRENT' || workingDraft.assets.length >= PLATFORM_DRAFT_IMAGE_LIMIT} onClick={() => setPicker({ replaceIndex: null })}><ImagePlus size={15}/>选择素材</button><button className="button" type="button" disabled={sourceState !== 'CURRENT'} onClick={() => setImageTaskOpen((value) => !value)}><Sparkles size={15}/>{imageTaskOpen ? '收起生图任务' : 'AI 生图任务'}</button></footer>
      </section>
    </div>

    {imageTaskOpen && <section className="platform-generation-panel" aria-label="AI 生图任务">
      <header><div><span>显式任务策略</span><h3>AI 生图</h3></div><div className="platform-generation-modes" role="group" aria-label="生图方式"><button type="button" className={imageOperation === 'TEXT_TO_IMAGE' ? 'active' : ''} onClick={() => setImageOperation('TEXT_TO_IMAGE')}>文生图</button><button type="button" className={imageOperation === 'IMAGE_TO_IMAGE' ? 'active' : ''} disabled={!workingDraft.assets.length} onClick={() => setImageOperation('IMAGE_TO_IMAGE')}>图生图</button></div></header>
      <dl className="platform-policy-grid"><div><dt>Scope</dt><dd>{imageOperation}</dd></div><div><dt>Provider</dt><dd>{policyLoading ? '读取中' : activePolicy?.provider ?? '未配置'}</dd></div><div><dt>Model</dt><dd>{policyLoading ? '读取中' : activePolicy?.model ?? '未配置'}</dd></div><div><dt>输出比例</dt><dd>{platform === 'XIAOHONGSHU' ? '3:4' : '1:1'}</dd></div></dl>
      <label><span>画面要求</span><textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} maxLength={8000}/></label>
      {imageOperation === 'IMAGE_TO_IMAGE' && <label><span>参考图片</span><select value={referenceAssetId} onChange={(event) => setReferenceAssetId(event.target.value)}>{workingDraft.assets.map(({ assetId }, index) => <option key={assetId} value={assetId}>{index + 1}. {assets[assetId]?.title ?? assetId}</option>)}</select></label>}
      {lastGenerationPolicy && <div className="platform-generation-success"><CheckCircle2 size={16}/><span>已由 {lastGenerationPolicy.provider} / {lastGenerationPolicy.model} 完成 {lastGenerationPolicy.scope}</span></div>}
      <footer><button className="text-button" type="button" onClick={onOpenModelSettings}>管理任务策略</button><button className="button primary" type="button" disabled={generating || policyLoading || !activePolicy?.provider || !activePolicy.model} onClick={() => void generateImage()}>{generating ? <LoaderCircle size={15}/> : <Sparkles size={15}/>}确认策略并生成</button></footer>
    </section>}

    {picker && <AssetPickerDialog projectId={workingDraft.projectId} role="VISUAL" scope="IMAGING" platforms={[platform]} excludedAssetIds={workingDraft.assets.map(({ assetId }) => assetId)} imageOnly onLinked={(asset) => void selectAsset(asset)} onClose={() => setPicker(null)}/>} 
    {previewAsset && <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)}/>} 
  </section>;
}
