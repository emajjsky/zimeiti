import { Check, Image, LoaderCircle, Minus, Palette, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject, type CreativeVisualGenerationMode, type CreativeVisualPlanItem, type CreativeVisualReferenceUse, type CreativeVisualSize, type CreativeVisualStylePreset } from '../../domain/content';
import type { CreativePlatform, ProjectReference } from '../../domain/creative';
import { buildVisualPlan, mergeVisualPlan, resizeVisualPlan, updateVisualPlanItem, visualPlanCountRange, visualStylePresets, visualTemplatesFor, VISUAL_PLAN_VERSION } from '../../domain/visual-plan.mjs';

type ImageSearchResult = { id: string; title: string; thumbnailUrl: string; imageUrl: string; sourceUrl: string; license: string; attribution: string };
type SourceView = 'search' | 'generate' | 'library';

function usableVisualReference(item: ProjectReference) {
  return item.role === 'VISUAL' || item.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(item.url ?? '');
}

function visualPayload(platform: CreativePlatform, plan: CreativeVisualPlanItem[], styleProfile: { preset: CreativeVisualStylePreset }) {
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

const visualTypes = ['NEWS_PHOTO', 'HERO_VISUAL', 'SCENE', 'CONCEPT_DIAGRAM', 'MIND_MAP', 'FLOWCHART', 'TIMELINE', 'COMPARISON', 'DATA_CHART', 'INFO_CARD', 'CHECKLIST_CARD', 'QUOTE_CARD'] as const;
const referenceModes: { id: string; name: string; uses: CreativeVisualReferenceUse[] }[] = [
  { id: 'COLOR_LAYOUT', name: '色彩与排版', uses: ['COLOR', 'LAYOUT'] },
  { id: 'COMPOSITION', name: '构图', uses: ['COMPOSITION'] },
  { id: 'TEXTURE', name: '质感', uses: ['TEXTURE'] },
  { id: 'SUBJECT', name: '人物 / 主体', uses: ['SUBJECT'] },
  { id: 'ALL', name: '全部视觉特征', uses: ['COLOR', 'COMPOSITION', 'LAYOUT', 'TEXTURE', 'SUBJECT'] },
];

function referenceModeValue(uses: CreativeVisualReferenceUse[]) {
  return referenceModes.find((mode) => mode.uses.length === uses.length && mode.uses.every((use) => uses.includes(use)))?.id ?? 'COLOR_LAYOUT';
}

export function VisualWorkspace({ project, activePlatform, onProjectChange, onOpenModelSettings }: {
  project: ContentProject;
  activePlatform: CreativePlatform;
  onProjectChange: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
}) {
  const currentDelivery = project.delivery?.platforms?.[activePlatform];
  const version = project.versions.find((item) => item.platform === activePlatform);
  const planInput = useMemo(() => ({
    title: project.planning.title || project.title || version?.title || '未命名内容',
    body: version?.body || '',
    category: project.planning.category,
    coreMessage: project.planning.coreMessage || project.coreViewpoint,
  }), [project.coreViewpoint, project.planning.category, project.planning.coreMessage, project.planning.title, project.title, version?.body, version?.title]);
  const persistedBodyItemCount = useMemo(() => {
    const persisted = currentDelivery?.visual?.plan;
    if (!Array.isArray(persisted) || currentDelivery?.visual?.planVersion !== VISUAL_PLAN_VERSION) return undefined;
    return activePlatform === 'WEIBO' ? persisted.length : persisted.filter((item) => item.role === 'BODY' || item.role === 'CARD').length;
  }, [activePlatform, currentDelivery?.visual?.plan, currentDelivery?.visual?.planVersion]);
  const generatedPlan = useMemo(() => buildVisualPlan(planInput, activePlatform, { bodyItemCount: persistedBodyItemCount }), [activePlatform, persistedBodyItemCount, planInput]);
  const [plan, setPlan] = useState<CreativeVisualPlanItem[]>([]);
  const [styleProfile, setStyleProfile] = useState<{ preset: CreativeVisualStylePreset }>({ preset: 'FRESH_EDITORIAL' });
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
  const assignedAsset = activeItem?.assetReferenceId ? assets.find((item) => item.id === activeItem.assetReferenceId) : undefined;
  const referenceAssets = activeItem?.references.map((item) => ({ config: item, asset: assets.find((asset) => asset.id === item.referenceId) })).filter((item) => item.asset) ?? [];
  const boundCount = plan.filter((item) => item.assetReferenceId).length;
  const bodyItemCount = activePlatform === 'WEIBO' ? plan.length : plan.filter((item) => item.role === 'BODY' || item.role === 'CARD').length;
  const countRange = visualPlanCountRange(activePlatform);
  const hasCopy = String(version?.body ?? '').trim().length >= 80;

  useEffect(() => {
    const next = mergeVisualPlan(generatedPlan, currentDelivery?.visual?.plan, currentDelivery?.visual?.assetReferenceIds ?? [], currentDelivery?.visual?.coverReferenceId ?? null, currentDelivery?.visual?.planVersion ?? 0);
    const projectKey = `${project.id}:${activePlatform}`;
    const switchedProject = hydratedProjectKey.current !== projectKey;
    const nextStyleProfile = currentDelivery?.visual?.styleProfile ?? { preset: 'FRESH_EDITORIAL' as const };
    setPlan((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    setStyleProfile((current) => JSON.stringify(current) === JSON.stringify(nextStyleProfile) ? current : nextStyleProfile);
    setActiveItemId((current) => !switchedProject && next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
    if (switchedProject) {
      setSearchQuery(next[0]?.searchQueries[0] ?? '');
      setSearchResults([]);
      setSourceView('search');
      setReferencePickerOpen(false);
    }
    hydratedProjectKey.current = projectKey;
    setHydratedPlanKey(projectKey);
    lastSavedSignature.current = Array.isArray(currentDelivery?.visual?.plan) && currentDelivery.visual.planVersion === VISUAL_PLAN_VERSION ? JSON.stringify({ plan: next, styleProfile: nextStyleProfile }) : '';
  }, [activePlatform, currentDelivery?.visual?.updatedAt, generatedPlan, project.id]);

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
  }, [activePlatform, hydratedPlanKey, onProjectChange, plan, project.id, styleProfile]);

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

  const updateActiveItem = (patch: Partial<CreativeVisualPlanItem>, compile = true) => {
    if (!activeItem) return;
    setPlan((current) => current.map((item) => {
      if (item.id !== activeItem.id) return item;
      return compile ? updateVisualPlanItem(item, patch, { platform: activePlatform, title: planInput.title }, styleProfile) : { ...item, ...patch };
    }));
  };

  const changeGenerationMode = (mode: CreativeVisualGenerationMode) => {
    if (!activeItem || activeItem.generationMode === mode) return;
    updateActiveItem({ generationMode: mode });
  };

  const changeProjectStyle = (preset: CreativeVisualStylePreset) => {
    const nextProfile = { preset };
    setStyleProfile(nextProfile);
    setPlan((current) => current.map((item) => item.stylePreset === 'INHERIT'
      ? updateVisualPlanItem(item, {}, { platform: activePlatform, title: planInput.title }, nextProfile)
      : item));
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

  const changeContentBlock = (index: number, patch: { label?: string; detail?: string }) => {
    if (!activeItem) return;
    updateActiveItem({ contentBlocks: activeItem.contentBlocks.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
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
    if (!activeItem || activeItem.prompt.trim().length < 4) return;
    setGenerateBusy(true); setError('');
    try {
      const { reference } = await webCreative.generateImage(project.id, {
        platform: activePlatform, prompt: activeItem.prompt.trim(), size: activeItem.size,
        negativePrompt: activeItem.negativePrompt.trim() || undefined,
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

  const regenerate = () => {
    if (!window.confirm('重新规划会保留封面，正文图片将退回项目素材库。是否继续？')) return;
    const coverId = plan.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetReferenceId ?? null;
    const rebuilt = buildVisualPlan(planInput, activePlatform, { bodyItemCount });
    const next = rebuilt.map((item) => ({ ...item, assetReferenceId: item.role === 'COVER' || item.role === 'MAIN' ? coverId : null }));
    setPlan(next);
    setActiveItemId(next[0]?.id ?? '');
    setSearchQuery(next[0]?.searchQueries[0] ?? '');
    setSearchResults([]);
    setNotice('已按当前正文重新规划，正文配图需要重新匹配。');
  };

  const changeBodyItemCount = (delta: number) => {
    const target = Math.max(countRange.min, Math.min(countRange.max, bodyItemCount + delta));
    if (target === bodyItemCount) return;
    const next = resizeVisualPlan(buildVisualPlan(planInput, activePlatform, { bodyItemCount: target }), plan);
    setPlan(next);
    setActiveItemId((current) => next.some((item) => item.id === current) ? current : next.at(-1)?.id ?? '');
    setSearchResults([]);
    setNotice(target > bodyItemCount ? '已增加配图位置。' : '已减少配图位置，原图片仍保留在项目素材中。');
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
        <label className="visual-project-style"><Palette size={15}/><span>项目风格</span><select aria-label="项目默认风格" value={styleProfile.preset} onChange={(event) => changeProjectStyle(event.target.value as CreativeVisualStylePreset)}>{visualStylePresets().map((style) => <option value={style.id} key={style.id}>{style.name}</option>)}</select></label>
        <div className="visual-count-stepper" aria-label="配图数量">
          <button type="button" aria-label={activePlatform === 'WEIBO' ? '减少主图' : '减少正文插图'} disabled={bodyItemCount <= countRange.min} onClick={() => changeBodyItemCount(-1)}><Minus size={14}/></button>
          <output aria-label={activePlatform === 'WEIBO' ? '主图数量' : '正文插图数量'}>{bodyItemCount}</output>
          <button type="button" aria-label={activePlatform === 'WEIBO' ? '增加主图' : '增加正文插图'} disabled={bodyItemCount >= countRange.max} onClick={() => changeBodyItemCount(1)}><Plus size={14}/></button>
        </div>
        <button className="button" type="button" onClick={regenerate}><RefreshCw size={15}/>重新规划</button>
      </div>
    </header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    {notice && <div className="visual-workspace-notice" role="status">{notice}</div>}

    <div className="visual-plan-layout">
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
          <div><span>{roleName(activeItem.role)} / {visualTypeName(activeItem.visualType)} / {activeItem.placement}</span><h3>{activeItem.title}</h3><p>{activeItem.purpose}</p></div>
          {assignedAsset && <div className="visual-assigned-asset"><Check size={17}/><span><b>已绑定</b><small>{assignedAsset.title}</small></span><button type="button" title="移除当前配图" onClick={() => updateActiveItem({ assetReferenceId: null }, false)}><Trash2 size={15}/></button></div>}
        </header>

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
              <div className="visual-director-controls">
                <label><span>视觉结构</span><select aria-label="视觉结构" value={activeItem.visualType} onChange={(event) => updateActiveItem({ visualType: event.target.value as CreativeVisualPlanItem['visualType'] })}>{visualTypes.map((type) => <option value={type} key={type}>{visualTypeName(type)}</option>)}</select></label>
                <label><span>版式模板</span><select aria-label="版式模板" value={activeItem.templatePreset} onChange={(event) => updateActiveItem({ templatePreset: event.target.value })}>{visualTemplatesFor(activeItem.visualType).map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
                <label><span>单图风格</span><select aria-label="单图风格" value={activeItem.stylePreset} onChange={(event) => updateActiveItem({ stylePreset: event.target.value as CreativeVisualPlanItem['stylePreset'] })}><option value="INHERIT">跟随项目 · {visualStylePresets().find((style) => style.id === styleProfile.preset)?.name}</option>{visualStylePresets().map((style) => <option value={style.id} key={style.id}>{style.name}</option>)}</select></label>
              </div>
              <div className="visual-generation-modes" role="group" aria-label="图片生成模式">
                <button type="button" className={activeItem.generationMode === 'ILLUSTRATION' ? 'active' : ''} onClick={() => changeGenerationMode('ILLUSTRATION')}>视觉插图</button>
                <button type="button" className={activeItem.generationMode === 'INFOGRAPHIC' ? 'active' : ''} onClick={() => changeGenerationMode('INFOGRAPHIC')}>图文信息图</button>
              </div>
              <details className="visual-director-details">
                <summary>查看策划</summary>
                <div>
                  <div className="visual-director-source"><b>原文依据</b><p>{activeItem.sourceExcerpt}</p></div>
                  <div className="visual-director-blocks">{activeItem.contentBlocks.map((block, index) => <div key={`${activeItem.id}-block-${index}`}><input aria-label={`结构标题 ${index + 1}`} value={block.label} onChange={(event) => changeContentBlock(index, { label: event.target.value })}/><textarea aria-label={`结构内容 ${index + 1}`} value={block.detail} onChange={(event) => changeContentBlock(index, { detail: event.target.value })}/></div>)}</div>
                </div>
              </details>
              <section className="visual-reference-panel">
                <header><b>参考图</b><button className="text-button" type="button" disabled={activeItem.references.length >= 3 || !assets.length} onClick={() => setReferencePickerOpen((open) => !open)}><Plus size={14}/>添加参考图</button></header>
                {referenceAssets.length > 0 && <div className="visual-reference-list">{referenceAssets.map(({ config, asset }) => asset && <article key={config.referenceId}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <span><Image size={16}/></span>}<b>{asset.title}</b><select aria-label="参考方式" value={referenceModeValue(config.uses)} onChange={(event) => changeReferenceMode(config.referenceId, event.target.value)}>{referenceModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name}</option>)}</select><button type="button" title={`移除参考图 ${asset.title}`} onClick={() => removeReference(config.referenceId)}><X size={14}/></button></article>)}</div>}
                {referencePickerOpen && <div className="visual-reference-picker">{assets.filter((asset) => !activeItem.references.some((item) => item.referenceId === asset.id)).map((asset) => <button type="button" key={asset.id} onClick={() => addReference(asset)}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <Image size={18}/>}<span>{asset.title}</span></button>)}</div>}
              </section>
              <div className="visual-generate-controls">
                <label><span>图片比例</span><select value={activeItem.size} onChange={(event) => updateActiveItem({ size: event.target.value as CreativeVisualSize }, false)}><option value="1:1">1:1 方图</option><option value="3:4">3:4 竖图</option><option value="4:3">4:3 横图</option><option value="9:16">9:16 竖版</option><option value="16:9">16:9 横版</option></select></label>
                <button className="button primary" type="button" disabled={generateBusy || activeItem.prompt.trim().length < 4} onClick={() => void generate()}>{generateBusy ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成这一张</button>
              </div>
              <details className="visual-generation-details">
                <summary>高级设置</summary>
                <div>
                  <label className="visual-prompt-field"><span>生图提示词</span><textarea value={activeItem.prompt} onChange={(event) => updateActiveItem({ prompt: event.target.value }, false)}/></label>
                  <label className="visual-prompt-field compact"><span>负面提示词</span><textarea value={activeItem.negativePrompt} onChange={(event) => updateActiveItem({ negativePrompt: event.target.value }, false)}/></label>
                </div>
              </details>
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
    </div>

    <footer className="delivery-workspace-footer"><span>{saveState === 'saving' ? '正在自动保存配图方案' : boundCount ? `已绑定 ${boundCount}/${plan.length} 张图片` : '方案已生成，可从第一张开始选图'}</span><div><button className="button" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16}/> : <Save size={16}/>}保存</button><button className="button primary" type="button" disabled={busy !== null || !hasCopy} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : null}确认素材，进入排版</button></div></footer>
  </section>;
}
