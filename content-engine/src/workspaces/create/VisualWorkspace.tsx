import { Check, Image, LoaderCircle, Minus, Palette, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject, type CreativeVisualPlanItem, type CreativeVisualReferenceUse, type CreativeVisualStyleProfile } from '../../domain/content';
import type { CreativePlatform, ProjectReference } from '../../domain/creative';
import { visualPlanCountRange, visualStylePresets, VISUAL_PLAN_VERSION } from '../../domain/visual-plan.mjs';

type ImageSearchResult = { id: string; title: string; thumbnailUrl: string; imageUrl: string; sourceUrl: string; license: string; attribution: string };
type SourceView = 'search' | 'generate' | 'library';

function usableVisualReference(item: ProjectReference) {
  return item.role === 'VISUAL' || item.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(item.url ?? '');
}

function visualPayload(platform: CreativePlatform, plan: CreativeVisualPlanItem[], styleProfile: CreativeVisualStyleProfile) {
  const assetReferenceIds = [...new Set(plan.map((item) => item.assetReferenceId).filter((id): id is string => Boolean(id)))];
  const coverReferenceId = plan.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetReferenceId ?? assetReferenceIds[0] ?? null;
  return { platform, planVersion: VISUAL_PLAN_VERSION, styleProfile, coverReferenceId, assetReferenceIds, plan };
}

function roleName(role: CreativeVisualPlanItem['role']) {
  return ({ COVER: '封面', BODY: '正文图', CARD: '图文卡片', MAIN: '主图' } as const)[role];
}

function visualTypeName(type: CreativeVisualPlanItem['visualType']) {
  return ({ NEWS_PHOTO: '新闻资料图', HERO_VISUAL: '主体主视觉', CONCEPT_DIAGRAM: '概念示意图', SCENE: '场景图', MIND_MAP: '思维导图', FLOWCHART: '流程图', TIMELINE: '时间线', COMPARISON: '对比图', DATA_CHART: '数据图', QUOTE_CARD: '引语卡片', INFO_CARD: '信息卡片', CHECKLIST_CARD: '清单卡片' } as const)[type];
}

const referenceModes: { id: string; name: string; uses: CreativeVisualReferenceUse[] }[] = [
  { id: 'COLOR_LAYOUT', name: '色彩与排版', uses: ['COLOR', 'LAYOUT'] },
  { id: 'COMPOSITION', name: '构图', uses: ['COMPOSITION'] },
  { id: 'TEXTURE', name: '质感', uses: ['TEXTURE'] },
  { id: 'SUBJECT', name: '人物 / 主体', uses: ['SUBJECT'] },
  { id: 'ALL', name: '全部视觉特征', uses: ['COLOR', 'COMPOSITION', 'LAYOUT', 'TEXTURE', 'SUBJECT'] },
];
const allVisualStyles = visualStylePresets();
const visualStyles = allVisualStyles.filter((style) => style.featured);
const visualStyleGroupLabels = {
  EDITORIAL: '编辑与纪实', KNOWLEDGE: '知识与信息', ILLUSTRATION: '插画与创意', CULTURAL: '东方与文化', TECHNOLOGY: '科技与产业',
} as const;
const visualStyleGroups = Object.entries(visualStyleGroupLabels).map(([id, name]) => ({
  id: id as keyof typeof visualStyleGroupLabels,
  name,
  styles: visualStyles.filter((style) => style.group === id),
}));
type VisualStyleGroupId = (typeof visualStyleGroups)[number]['id'];
type VisualStyleDefinition = (typeof visualStyles)[number];

function VisualStylePreview({ style, large = false }: { style: VisualStyleDefinition; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={'visual-style-preview' + (large ? ' large' : '')} data-style={style.id}>
    {!failed && style.previewImage ? <img src={style.previewImage} alt={`${style.name}风格的多平台配图案例`} onError={() => setFailed(true)}/> : <span className="visual-style-preview-missing"><Image size={large ? 26 : 18}/><b>案例图待生成</b></span>}
  </span>;
}

function referenceModeValue(uses: CreativeVisualReferenceUse[]) {
  return referenceModes.find((mode) => mode.uses.length === uses.length && mode.uses.every((use) => uses.includes(use)))?.id ?? 'COLOR_LAYOUT';
}

function recommendedBodyItemCount(platform: CreativePlatform, body: string) {
  const length = String(body ?? '').trim().length;
  if (platform === 'WEIBO') return 1;
  if (platform === 'XIAOHONGSHU') return Math.min(8, 5 + Math.floor(length / 900));
  const range = visualPlanCountRange(platform);
  return Math.min(range.max, Math.max(range.min, 2 + Math.floor(length / 1_200)));
}

function safePlan(items: unknown): CreativeVisualPlanItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is CreativeVisualPlanItem => Boolean(item && typeof item === 'object')).map((item) => ({
    ...item,
    avoidConcepts: Array.isArray(item.avoidConcepts) ? item.avoidConcepts : [],
    searchQueries: Array.isArray(item.searchQueries) ? item.searchQueries.filter(Boolean) : [],
    informationPoints: Array.isArray(item.informationPoints) ? item.informationPoints.filter(Boolean) : [],
    sourceExcerpt: String(item.sourceExcerpt ?? ''),
    contentBlocks: Array.isArray(item.contentBlocks) ? item.contentBlocks : [],
    references: Array.isArray(item.references) ? item.references : [],
    prompt: String(item.prompt ?? ''),
    assetReferenceId: item.assetReferenceId ?? null,
  }));
}

export function VisualWorkspace({ project, activePlatform, onProjectChange, onOpenModelSettings }: {
  project: ContentProject;
  activePlatform: CreativePlatform;
  onProjectChange: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
}) {
  const currentDelivery = project.delivery?.platforms?.[activePlatform];
  const version = project.versions.find((item) => item.platform === activePlatform);
  const [plan, setPlan] = useState<CreativeVisualPlanItem[]>([]);
  const [bodyItemCount, setBodyItemCount] = useState(0);
  const [styleProfile, setStyleProfile] = useState<CreativeVisualStyleProfile>({ preset: 'FRESH_EDITORIAL', customPrompt: '' });
  const [styleDraft, setStyleDraft] = useState<CreativeVisualStyleProfile>({ preset: 'FRESH_EDITORIAL', customPrompt: '' });
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [activeStyleGroup, setActiveStyleGroup] = useState<VisualStyleGroupId>('EDITORIAL');
  const [planBusy, setPlanBusy] = useState(false);
  const [planNeedsRefresh, setPlanNeedsRefresh] = useState(false);
  const [itemRequest, setItemRequest] = useState('');
  const [planningModel, setPlanningModel] = useState('');
  const [hydratedPlanKey, setHydratedPlanKey] = useState('');
  const [activeItemId, setActiveItemId] = useState('');
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceView, setSourceView] = useState<SourceView>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const lastSavedSignature = useRef('');
  const saveRevision = useRef(0);
  const searchRevision = useRef(0);
  const hydratedProjectKey = useRef('');
  const assets = useMemo(() => references.filter(usableVisualReference), [references]);
  const activeItem = plan.find((item) => item.id === activeItemId) ?? plan[0];
  const activePrompt = String(activeItem?.prompt ?? '').trim();
  const assignedAsset = activeItem?.assetReferenceId ? assets.find((item) => item.id === activeItem.assetReferenceId) : undefined;
  const assignedAssetSrc = assignedAsset?.url ?? (assignedAsset ? fileUrls[assignedAsset.id] : undefined);
  const referenceAssets = activeItem?.references.map((item) => ({ config: item, asset: assets.find((asset) => asset.id === item.referenceId) })).filter((item) => item.asset) ?? [];
  const boundCount = plan.filter((item) => item.assetReferenceId).length;
  const countRange = visualPlanCountRange(activePlatform);
  const hasCopy = String(version?.body ?? '').trim().length >= 80;
  const selectedStyle = visualStyles.find((style) => style.id === styleDraft.preset) ?? visualStyles[0];
  const visibleStyleGroup = visualStyleGroups.find((group) => group.id === activeStyleGroup) ?? visualStyleGroups[0];

  useEffect(() => {
    const projectKey = `${project.id}:${activePlatform}`;
    const switchedProject = hydratedProjectKey.current !== projectKey;
    const persisted = currentDelivery?.visual?.planVersion === VISUAL_PLAN_VERSION ? safePlan(currentDelivery?.visual?.plan) : [];
    const legacy = safePlan(currentDelivery?.visual?.plan);
    const persistedCount = currentDelivery?.visual?.planVersion === VISUAL_PLAN_VERSION
      ? activePlatform === 'WEIBO' ? legacy.length : legacy.filter((item) => item.role === 'BODY' || item.role === 'CARD').length
      : 0;
    const nextCount = persistedCount || recommendedBodyItemCount(activePlatform, version?.body ?? '');
    const nextStyleProfile = { preset: currentDelivery?.visual?.styleProfile?.preset ?? 'FRESH_EDITORIAL' as const, customPrompt: currentDelivery?.visual?.styleProfile?.customPrompt ?? '' };
    setPlan((current) => JSON.stringify(current) === JSON.stringify(persisted) ? current : persisted);
    setBodyItemCount(nextCount);
    setStyleProfile((current) => JSON.stringify(current) === JSON.stringify(nextStyleProfile) ? current : nextStyleProfile);
    setActiveItemId((current) => !switchedProject && persisted.some((item) => item.id === current) ? current : persisted[0]?.id ?? '');
    if (switchedProject) {
      setSearchQuery(persisted[0]?.searchQueries[0] ?? '');
      setSearchResults([]);
      setSourceView('search');
      setReferencePickerOpen(false);
      setPlanNeedsRefresh(false);
      setPlanningModel('');
    }
    hydratedProjectKey.current = projectKey;
    setHydratedPlanKey(projectKey);
    lastSavedSignature.current = persisted.length ? JSON.stringify({ plan: persisted, styleProfile: nextStyleProfile }) : '';
  }, [activePlatform, currentDelivery?.visual?.updatedAt, project.id, version?.body]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    webCreative.materials(project.id).then((result) => {
      if (!cancelled) setReferences(result.references);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取素材失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    const localAssets = assets.filter((asset) => asset.sourceType === 'FILE' && !fileUrls[asset.id]);
    if (!localAssets.length) return;
    void Promise.all(localAssets.map(async (asset) => {
      const blob = await webCreative.projectFile(asset.id);
      return [asset.id, URL.createObjectURL(blob)] as const;
    })).then((items) => {
      if (cancelled) { items.forEach(([, url]) => URL.revokeObjectURL(url)); return; }
      setFileUrls((current) => ({ ...current, ...Object.fromEntries(items) }));
    }).catch(() => { /* 素材仍可绑定，预览失败不阻塞工作流。 */ });
    return () => { cancelled = true; };
  }, [assets, fileUrls]);

  useEffect(() => {
    if (!hasCopy || !plan.length) return;
    if (hydratedPlanKey !== `${project.id}:${activePlatform}`) return;
    const signature = JSON.stringify({ plan, styleProfile });
    if (signature === lastSavedSignature.current) return;
    const revision = ++saveRevision.current;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void webCreative.saveVisual(project.id, visualPayload(activePlatform, plan, styleProfile)).then((result) => {
        if (revision !== saveRevision.current) return;
        lastSavedSignature.current = signature;
        setSaveState('saved');
        onProjectChange(result.project);
      }).catch((reason) => {
        if (revision !== saveRevision.current) return;
        setSaveState('error');
        setError(reason instanceof Error ? reason.message : '配图方案自动保存失败。');
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activePlatform, hasCopy, hydratedPlanKey, onProjectChange, plan, project.id, styleProfile]);

  const runSearch = async (query: string) => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    const revision = ++searchRevision.current;
    setSearchQuery(normalized);
    setSearchBusy(true);
    setError('');
    try {
      const result = await webCreative.searchImages(normalized);
      if (revision === searchRevision.current) setSearchResults(result.results);
    } catch (reason) {
      if (revision === searchRevision.current) setError(reason instanceof Error ? reason.message : '搜索图片失败。');
    } finally {
      if (revision === searchRevision.current) setSearchBusy(false);
    }
  };

  const selectPlanItem = (item: CreativeVisualPlanItem) => {
    setActiveItemId(item.id);
    setSearchQuery(item.searchQueries[0] ?? '');
    setSearchResults([]);
    setNotice('');
    setReferencePickerOpen(false);
  };

  const updateActiveItem = (patch: Partial<CreativeVisualPlanItem>, _compile = false) => {
    if (!activeItem) return;
    setPlan((current) => current.map((item) => item.id === activeItem.id ? { ...item, ...patch } : item));
  };

  const changeProjectStyle = (profile: CreativeVisualStyleProfile) => {
    const nextProfile = { preset: profile.preset, customPrompt: profile.customPrompt?.trim() ?? '' };
    setStyleProfile(nextProfile);
    if (plan.length) setPlanNeedsRefresh(true);
  };

  const openStyleDialog = () => {
    const currentStyle = visualStyles.find((style) => style.id === styleProfile.preset) ?? visualStyles[0];
    setStyleDraft({ preset: currentStyle.id, customPrompt: styleProfile.customPrompt ?? '' });
    setActiveStyleGroup(currentStyle.group);
    setStyleDialogOpen(true);
  };

  const applyProjectStyle = () => {
    changeProjectStyle(styleDraft);
    setStyleDialogOpen(false);
    setNotice(plan.length ? '项目风格已更新。点击“更新方案”后应用到全部图片。' : '项目风格已更新。');
  };

  const addReference = (reference: ProjectReference) => {
    if (!activeItem || activeItem.references.some((item) => item.referenceId === reference.id) || activeItem.references.length >= 3) return;
    updateActiveItem({ references: [...activeItem.references, { referenceId: reference.id, uses: ['COLOR', 'LAYOUT'] }] });
    setReferencePickerOpen(false);
  };

  const removeReference = (referenceId: string) => {
    if (!activeItem) return;
    updateActiveItem({ references: activeItem.references.filter((item) => item.referenceId !== referenceId) });
  };

  const changeReferenceMode = (referenceId: string, modeId: string) => {
    if (!activeItem) return;
    const uses = referenceModes.find((mode) => mode.id === modeId)?.uses ?? ['COLOR', 'LAYOUT'];
    updateActiveItem({ references: activeItem.references.map((item) => item.referenceId === referenceId ? { ...item, uses } : item) });
  };

  const assignAsset = (reference: ProjectReference) => {
    setReferences((current) => current.some((item) => item.id === reference.id) ? current : [reference, ...current]);
    if (!activeItem) return;
    const normalizedUrl = reference.url?.trim();
    const previous = plan.find((item) => item.id !== activeItem.id && item.assetReferenceId && (
      item.assetReferenceId === reference.id || (normalizedUrl && assets.find((asset) => asset.id === item.assetReferenceId)?.url?.trim() === normalizedUrl)
    ));
    setPlan((current) => current.map((item) => {
      if (item.id === activeItem.id) return { ...item, assetReferenceId: reference.id };
      if (previous && item.id === previous.id) return { ...item, assetReferenceId: null };
      return item;
    }));
    setNotice(previous ? `这张图已从“${previous.title}”移动到“${activeItem.title}”。` : '图片已绑定到当前配图位置。');
  };

  const importResult = async (result: ImageSearchResult) => {
    setImportingId(result.id); setError('');
    try {
      const existing = references.find((item) => item.url?.trim() === result.imageUrl.trim());
      if (existing) { assignAsset(existing); return; }
      const reference = await webCreative.createReference(project.id, {
        title: result.title, url: result.imageUrl, role: 'VISUAL', scope: 'IMAGING', platforms: [activePlatform],
        notes: `Wikimedia Commons｜许可：${result.license}｜署名：${result.attribution}｜来源：${result.sourceUrl}`,
      });
      assignAsset(reference);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入图片失败。'); }
    finally { setImportingId(null); }
  };

  const generate = async () => {
    if (!activeItem || activePrompt.length < 4) return;
    setGenerateBusy(true); setError('');
    try {
      const { reference } = await webCreative.generateImage(project.id, {
        platform: activePlatform, prompt: activePrompt, size: activeItem.size,
        referenceImageIds: activeItem.references.map((item) => item.referenceId),
      });
      assignAsset(reference);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 生图失败。'); }
    finally { setGenerateBusy(false); }
  };

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const result = await webCreative.saveVisual(project.id, visualPayload(activePlatform, plan, styleProfile));
      lastSavedSignature.current = JSON.stringify({ plan, styleProfile });
      setSaveState('saved');
      onProjectChange(result.project);
    } catch (reason) { setSaveState('error'); setError(reason instanceof Error ? reason.message : '保存配图方案失败。'); }
    finally { setBusy(null); }
  };

  const complete = async () => {
    if (!hasCopy) { setError('请先完成当前渠道正文，再确认配图进入排版。'); return; }
    setBusy('complete'); setError('');
    try {
      await webCreative.saveVisual(project.id, visualPayload(activePlatform, plan, styleProfile));
      const result = await webCreative.completeVisual(project.id, activePlatform);
      lastSavedSignature.current = JSON.stringify({ plan, styleProfile });
      onProjectChange(result.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认配图失败。'); }
    finally { setBusy(null); }
  };

  const planWithAI = async (currentItemId?: string, request = '') => {
    if (!hasCopy || planBusy) return;
    setPlanBusy(true); setError(''); setNotice('');
    try {
      const result = await webCreative.planVisual(project.id, {
        platform: activePlatform,
        bodyItemCount,
        styleProfile,
        request,
        currentItemId,
        currentPlan: plan,
        keepAssignedAssets: true,
      });
      const next = safePlan(result.plan);
      setPlan(next);
      setPlanningModel(result.model);
      setPlanNeedsRefresh(false);
      setActiveItemId((current) => currentItemId && next.some((item) => item.id === currentItemId) ? currentItemId : next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
      const selected = currentItemId ? next.find((item) => item.id === currentItemId) : next[0];
      setSearchQuery(selected?.searchQueries[0] ?? '');
      setSearchResults([]);
      setItemRequest('');
      setNotice(currentItemId ? '这一张已按修改意见重新策划。' : `配图方案已由核心 Agent 完成，共 ${next.length} 张。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成配图方案失败。');
    } finally {
      setPlanBusy(false);
    }
  };

  const changeBodyItemCount = (delta: number) => {
    const target = Math.max(countRange.min, Math.min(countRange.max, bodyItemCount + delta));
    if (target === bodyItemCount) return;
    setBodyItemCount(target);
    if (plan.length) setPlanNeedsRefresh(true);
    setNotice(plan.length ? '图片数量已调整。点击“更新方案”后重新安排位置。' : '');
  };

  const planCountSummary = activePlatform === 'WEIBO'
    ? `主图 ${bodyItemCount} 张`
    : activePlatform === 'XIAOHONGSHU'
      ? `封面 1 张，内容页 ${bodyItemCount} 张`
      : `封面 1 张，正文插图 ${bodyItemCount} 张`;

  const assetSrc = (asset: ProjectReference | undefined) => asset?.url ?? (asset ? fileUrls[asset.id] : undefined);

  return <section className="visual-workspace">
    <header className="delivery-workspace-head visual-workspace-head">
      <div><h2>{platformName[activePlatform]}配图</h2><p>{planCountSummary}</p></div>
      <div className="visual-plan-actions">
        <button className="visual-project-style" type="button" aria-label="设置项目配图风格" onClick={openStyleDialog}><Palette size={15}/><span>项目风格</span><b>{allVisualStyles.find((style) => style.id === styleProfile.preset)?.name ?? visualStyles[0].name}</b></button>
        <div className="visual-count-stepper" aria-label="配图数量">
          <button type="button" aria-label={activePlatform === 'WEIBO' ? '减少主图' : '减少正文插图'} disabled={bodyItemCount <= countRange.min} onClick={() => changeBodyItemCount(-1)}><Minus size={14}/></button>
          <output aria-label={activePlatform === 'WEIBO' ? '主图数量' : '正文插图数量'}>{bodyItemCount}</output>
          <button type="button" aria-label={activePlatform === 'WEIBO' ? '增加主图' : '增加正文插图'} disabled={bodyItemCount >= countRange.max} onClick={() => changeBodyItemCount(1)}><Plus size={14}/></button>
        </div>
        {plan.length > 0 && <button className="button" type="button" disabled={planBusy || !hasCopy} onClick={() => void planWithAI()}>{planBusy ? <LoaderCircle size={15}/> : <RefreshCw size={15}/>} {planNeedsRefresh ? '更新方案' : '重新策划'}</button>}
      </div>
    </header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    {notice && <div className="visual-workspace-notice" role="status">{notice}</div>}

    {!plan.length ? <section className="visual-plan-empty">
      <div className="visual-plan-empty-mark"><Sparkles size={24}/></div>
      <h3>让核心 Agent 先读正文，再安排每一张图</h3>
      <p>它会确定插入位置、画面任务、图内信息、搜索词和最终生图指令。</p>
      <button className="button primary" type="button" disabled={planBusy || !hasCopy} onClick={() => void planWithAI()}>{planBusy ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成配图方案</button>
      {!hasCopy && <small>当前平台正文完成后即可开始。</small>}
    </section> : <div className="visual-plan-layout">
      <aside className="visual-plan-panel">
        <header><b>配图方案</b><span>{saveState === 'saving' ? '自动保存中' : saveState === 'error' ? '保存失败' : '已自动保存'}</span></header>
        <div className="visual-plan-list">{plan.map((item, index) => {
          const asset = item.assetReferenceId ? assets.find((candidate) => candidate.id === item.assetReferenceId) : undefined;
          const src = assetSrc(asset);
          return <button type="button" className={`visual-plan-item${item.id === activeItem?.id ? ' active' : ''}`} key={item.id} onClick={() => selectPlanItem(item)}>
            <span className="visual-plan-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="visual-plan-thumb">{src ? <img src={src} alt=""/> : <Image size={18}/>}</span>
            <span className="visual-plan-copy"><b>{item.title}</b><small>{item.placement}</small></span>
            <span className={`visual-plan-state${item.assetReferenceId ? ' done' : ''}`}>{item.assetReferenceId ? '已绑定' : '待选图'}</span>
          </button>;
        })}</div>
      </aside>

      {activeItem && <main className="visual-task-panel">
        <header className="visual-task-head">
          <div><span>{roleName(activeItem.role)} / {visualTypeName(activeItem.visualType)} / {activeItem.placement}</span><h3>{activeItem.title}</h3></div>
          {assignedAsset && <div className="visual-assigned-asset"><Check size={17}/><span><b>已绑定</b><small>{assignedAsset.title}</small></span><button type="button" title="移除当前配图" onClick={() => updateActiveItem({ assetReferenceId: null }, false)}><Trash2 size={15}/></button></div>}
        </header>

        {assignedAsset && sourceView !== 'generate' && <section className="visual-selected-preview" aria-label="当前选中图片预览">
          {assignedAssetSrc ? <img src={assignedAssetSrc} alt={`${activeItem.title}当前选中图片`}/> : <span><Image size={24}/>图片预览加载中</span>}
          <div><b>当前选中图片</b><small>{assignedAsset.title}</small></div>
        </section>}

        <nav className="visual-source-tabs" aria-label="当前配图获取方式">
          <button type="button" className={sourceView === 'search' ? 'active' : ''} onClick={() => setSourceView('search')}><Search size={15}/>搜图</button>
          <button type="button" className={sourceView === 'generate' ? 'active' : ''} onClick={() => setSourceView('generate')}><Sparkles size={15}/>AI 生图</button>
          <button type="button" className={sourceView === 'library' ? 'active' : ''} onClick={() => setSourceView('library')}><Upload size={15}/>项目素材</button>
        </nav>

        {sourceView === 'search' && <section className="visual-source-workspace">
          <div className="visual-query-chips">{activeItem.searchQueries.map((query) => <button type="button" className={query === searchQuery ? 'active' : ''} key={query} onClick={() => void runSearch(query)}>{query}</button>)}</div>
          <form className="visual-search-form" onSubmit={(event) => { event.preventDefault(); void runSearch(searchQuery); }}>
            <label><span>搜索词</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
            <button className="button primary" type="submit" disabled={searchBusy || searchQuery.trim().length < 2}>{searchBusy ? <LoaderCircle size={16}/> : <Search size={16}/>}搜索</button>
          </form>
          {searchBusy && !searchResults.length && <div className="visual-result-state"><LoaderCircle size={18}/>正在搜索公开许可图片</div>}
          {!searchBusy && searchResults.length === 0 && !error && <div className="visual-result-state">选择推荐词或输入关键词后搜索</div>}
          {searchResults.length > 0 && <div className="visual-search-grid">{searchResults.map((result) => <article className="visual-search-card" key={result.id}>
            <img src={result.thumbnailUrl} alt=""/><div><b>{result.title}</b><small>{result.license}</small></div>
            <footer><a href={result.sourceUrl} target="_blank" rel="noreferrer">查看来源</a><button className="button" type="button" disabled={importingId !== null} onClick={() => void importResult(result)}>{importingId === result.id ? <LoaderCircle size={15}/> : <Check size={15}/>}用于此处</button></footer>
          </article>)}</div>}
        </section>}

        {sourceView === 'generate' && <section className="visual-source-workspace visual-generate-workspace">
          <div className="visual-generate-layout">
            <div className={`visual-generated-preview${assignedAsset && assetSrc(assignedAsset) ? ' has-image' : ''}`} data-size={activeItem.size} style={{ aspectRatio: activeItem.size.replace(':', ' / ') }}>
              {assignedAsset && assetSrc(assignedAsset) ? <img src={assetSrc(assignedAsset)} alt={`${activeItem.title}预览`}/> : <div><Image size={28}/><span>尚未生成图片</span></div>}
            </div>
            <div className="visual-generate-sidebar">
              <section className="visual-director-brief">
                <div><span>画面任务</span><b>{activeItem.focus}</b></div>
                <div><span>为什么配</span><p>{activeItem.purpose}</p></div>
                <div><span>正文依据</span><p>{activeItem.sourceExcerpt}</p></div>
                {activeItem.generationMode === 'INFOGRAPHIC' && <div className="visual-director-information"><span>图内信息</span><dl>{activeItem.contentBlocks.map((block, index) => <div key={`${activeItem.id}-block-${index}`}><dt>{block.label}</dt><dd>{block.detail}</dd></div>)}</dl></div>}
              </section>
              <section className="visual-item-replan">
                <label htmlFor={`visual-request-${activeItem.id}`}>修改这张图</label>
                <div><input id={`visual-request-${activeItem.id}`} value={itemRequest} onChange={(event) => setItemRequest(event.target.value)} placeholder="例如：改成上市时间线，突出三个关键年份"/><button className="button" type="button" disabled={planBusy || itemRequest.trim().length < 2} onClick={() => void planWithAI(activeItem.id, itemRequest)}>{planBusy ? <LoaderCircle size={15}/> : <RefreshCw size={15}/>}重新策划</button></div>
              </section>
              <section className="visual-reference-panel">
                <header><b>参考图</b><button className="text-button" type="button" disabled={activeItem.references.length >= 3 || !assets.length} onClick={() => setReferencePickerOpen((open) => !open)}><Plus size={14}/>添加参考图</button></header>
                {referenceAssets.length > 0 && <div className="visual-reference-list">{referenceAssets.map(({ config, asset }) => asset && <article key={config.referenceId}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <span><Image size={16}/></span>}<b>{asset.title}</b><select aria-label="参考方式" value={referenceModeValue(config.uses)} onChange={(event) => changeReferenceMode(config.referenceId, event.target.value)}>{referenceModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name}</option>)}</select><button type="button" title={`移除参考图 ${asset.title}`} onClick={() => removeReference(config.referenceId)}><X size={14}/></button></article>)}</div>}
                {referencePickerOpen && <div className="visual-reference-picker">{assets.filter((asset) => !activeItem.references.some((item) => item.referenceId === asset.id)).map((asset) => <button type="button" key={asset.id} onClick={() => addReference(asset)}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <Image size={18}/>}<span>{asset.title}</span></button>)}</div>}
              </section>
              <div className="visual-generate-controls">
                <span><b>{visualTypeName(activeItem.visualType)}</b><small>{activeItem.size}</small></span>
                <button className="button primary" type="button" disabled={generateBusy || activePrompt.length < 4} onClick={() => void generate()}>{generateBusy ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成这一张</button>
              </div>
              <button className="text-button visual-model-link" type="button" onClick={onOpenModelSettings}>文生图模型设置</button>
            </div>
          </div>
        </section>}

        {sourceView === 'library' && <section className="visual-source-workspace">
          {loading ? <div className="visual-result-state"><LoaderCircle size={18}/>读取项目素材</div> : assets.length ? <div className="visual-library-grid">{assets.map((asset) => {
            const src = assetSrc(asset); const checked = activeItem.assetReferenceId === asset.id;
            return <article className={`visual-library-card${checked ? ' selected' : ''}`} key={asset.id}>{src ? <img src={src} alt=""/> : <span><Image size={20}/></span>}<div><b>{asset.title}</b><small>{asset.sourceType === 'FILE' ? '项目文件' : '网络图片'}</small></div><button className="button" type="button" onClick={() => assignAsset(asset)}>{checked ? <><Check size={14}/>已用于此处</> : '用于此处'}</button></article>;
          })}</div> : <div className="visual-result-state"><Image size={20}/>还没有图片素材</div>}
        </section>}
      </main>}
    </div>}

    {plan.length > 0 && <footer className="delivery-workspace-footer"><span>{saveState === 'saving' ? '正在自动保存配图方案' : boundCount ? `已绑定 ${boundCount}/${plan.length} 张图片` : planningModel ? `方案由 ${planningModel} 策划` : '方案已生成，可从第一张开始选图'}</span><div><button className="button" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16}/> : <Save size={16}/>}保存</button><button className="button primary" type="button" disabled={busy !== null || !hasCopy} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : null}确认素材，进入排版</button></div></footer>}

    {styleDialogOpen && <div className="visual-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setStyleDialogOpen(false); }}>
      <section className="visual-style-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-style-dialog-title">
        <header><div><h2 id="visual-style-dialog-title">项目配图风格</h2><span>{visualStyles.length} 套案例模板</span></div><button className="icon-button" type="button" aria-label="关闭风格设置" onClick={() => setStyleDialogOpen(false)}><X size={18}/></button></header>
        <div className="visual-style-dialog-body">
          <nav className="visual-style-tabs" aria-label="风格分类">{visualStyleGroups.map((group) => <button type="button" className={group.id === activeStyleGroup ? 'active' : ''} key={group.id} onClick={() => setActiveStyleGroup(group.id)}><span>{group.name}</span><small>{group.styles.length}</small></button>)}</nav>
          <div className="visual-style-browser">
            <section className="visual-style-gallery" aria-label={visibleStyleGroup.name + '案例模板'}>
              {visibleStyleGroup.styles.map((style) => <button aria-label={style.name + '：' + style.description} className={'visual-style-card' + (styleDraft.preset === style.id ? ' active' : '')} type="button" key={style.id} onClick={() => setStyleDraft((current) => ({ ...current, preset: style.id }))}><VisualStylePreview style={style}/><span className="visual-style-card-copy"><b>{style.name}</b><small>{style.description}</small></span>{styleDraft.preset === style.id && <span className="visual-style-selected"><Check size={13}/>已选</span>}</button>)}
            </section>
            <aside className="visual-style-inspector">
              <VisualStylePreview style={selectedStyle} large/>
              <div className="visual-style-inspector-head"><div><b>{selectedStyle.name}</b><span>{selectedStyle.description}</span></div><span className="visual-style-palette" aria-label="模板配色">{selectedStyle.swatches.map((color) => <i key={color} style={{ background: color }}/>)}</span></div>
              <label className="visual-style-custom"><span>统一补充要求</span><textarea maxLength={1200} value={styleDraft.customPrompt ?? ''} onChange={(event) => setStyleDraft((current) => ({ ...current, customPrompt: event.target.value }))} placeholder="可补充品牌色、构图偏好、参考质感或必须保留的视觉元素"/><small>{styleDraft.customPrompt?.length ?? 0}/1200</small></label>
            </aside>
          </div>
        </div>
        <footer><span>当前选择：<b>{selectedStyle.name}</b></span><button className="button" type="button" onClick={() => setStyleDialogOpen(false)}>取消</button><button className="button primary" type="button" onClick={applyProjectStyle}>应用到项目</button></footer>
      </section>
    </div>}

  </section>;
}
