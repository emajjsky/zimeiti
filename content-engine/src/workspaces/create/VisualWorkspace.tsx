import { Check, Image, LoaderCircle, Palette, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webAssets, webCreative, webDrafts } from '../../data/webApi';
import { type ContentProject, type CreativeVisualPlanItem, type CreativeVisualReferenceUse, type CreativeVisualStyleProfile } from '../../domain/content';
import type { CreativePlatform } from '../../domain/creative';
import type { ContentDraft } from '../../domain/content-drafts';
import type { ProjectAsset, WorkspaceAsset } from '../../domain/assets';
import { AssetPreviewDialog } from '../../components/assets/AssetPreviewDialog';
import { AssetPickerDialog } from '../../components/assets/AssetPickerDialog';
import { buildVisualGenerationSpec, updateVisualPlanItem, visualImageSize, visualPlanCountRange, visualStylePresets, VISUAL_PLAN_VERSION } from '../../domain/visual-plan.mjs';

type ImageSearchResult = { id: string; title: string; thumbnailUrl: string; imageUrl: string; sourceUrl: string; license: string; attribution: string; copyrightStatus: 'PENDING' | 'OPEN_LICENSE' };
type SourceView = 'search' | 'generate' | 'library';
type PlanningRoute = { scope: string; provider: string; model: string };
type QuantityMode = 'AUTO' | 'MANUAL';
type VisualSnapshot = { plan: CreativeVisualPlanItem[]; styleProfile: CreativeVisualStyleProfile; quantityMode: QuantityMode; bodyItemCount: number };

function usableVisualReference(item: ProjectAsset) {
  return item.kind === 'IMAGE' && item.mimeType.startsWith('image/');
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
    {!failed && style.previewImage ? <img src={style.previewImage} alt={`${style.name}艺术方向案例`} onError={() => setFailed(true)}/> : <span className="visual-style-preview-missing"><Image size={large ? 26 : 18}/><b>方向案例待生成</b></span>}
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
    size: visualImageSize('WECHAT', item.role),
    assetId: item.assetId ?? null,
  }));
}

export function VisualWorkspace({ project, draft, onDraftChange, onContinue, onOpenModelSettings }: {
  project: ContentProject;
  draft: ContentDraft;
  onDraftChange: (draft: ContentDraft) => void;
  onContinue: () => void;
  onOpenModelSettings: () => void;
}) {
  const platform: CreativePlatform = 'WECHAT';
  const persistedVisual = draft.visualPlan as { planVersion?: number; plan?: unknown; styleProfile?: CreativeVisualStyleProfile; quantityMode?: QuantityMode; bodyItemCount?: number; workflowStatus?: string };
  const [plan, setPlan] = useState<CreativeVisualPlanItem[]>([]);
  const [bodyItemCount, setBodyItemCount] = useState(0);
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('AUTO');
  const [styleProfile, setStyleProfile] = useState<CreativeVisualStyleProfile>({ preset: 'FRESH_EDITORIAL', customPrompt: '' });
  const [styleDraft, setStyleDraft] = useState<CreativeVisualStyleProfile>({ preset: 'FRESH_EDITORIAL', customPrompt: '' });
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [activeStyleGroup, setActiveStyleGroup] = useState<VisualStyleGroupId>('EDITORIAL');
  const [planBusy, setPlanBusy] = useState(false);
  const [planNeedsRefresh, setPlanNeedsRefresh] = useState(false);
  const [itemRequest, setItemRequest] = useState('');
  const [planningRoute, setPlanningRoute] = useState<PlanningRoute | null>(null);
  const [hydratedPlanKey, setHydratedPlanKey] = useState('');
  const [activeItemId, setActiveItemId] = useState('');
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceView, setSourceView] = useState<SourceView>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchProvider, setSearchProvider] = useState('');
  const [searchError, setSearchError] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<WorkspaceAsset | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const lastSavedSignature = useRef('');
  const saveRevision = useRef(0);
  const searchRevision = useRef(0);
  const hydratedProjectKey = useRef('');
  const fileUrlsRef = useRef<Record<string, string>>({});
  const draftRef = useRef(draft);
  const saveQueue = useRef<Promise<ContentDraft>>(Promise.resolve(draft));
  const visualAssets = useMemo(() => assets.filter(usableVisualReference), [assets]);
  const activeItem = plan.find((item) => item.id === activeItemId) ?? plan[0];
  const activePrompt = activeItem ? buildVisualGenerationSpec(activeItem, { platform, title: draft.title }, activeItem.generationMode, styleProfile).prompt.trim() : '';
  const assignedAsset = activeItem?.assetId ? visualAssets.find((item) => item.id === activeItem.assetId) : undefined;
  const assignedAssetSrc = assignedAsset ? fileUrls[assignedAsset.id] : undefined;
  const referenceAssets = activeItem?.references.map((item) => ({ config: item, asset: visualAssets.find((asset) => asset.id === item.assetId) })).filter((item) => item.asset) ?? [];
  const boundCount = plan.filter((item) => item.assetId).length;
  const countRange = visualPlanCountRange(platform);
  const hasCopy = draft.body.trim().length >= 80;
  const selectedStyle = visualStyles.find((style) => style.id === styleDraft.preset) ?? visualStyles[0];
  const visibleStyleGroup = visualStyleGroups.find((group) => group.id === activeStyleGroup) ?? visualStyleGroups[0];

  useEffect(() => {
    const projectKey = `${project.id}:${platform}`;
    const switchedProject = hydratedProjectKey.current !== projectKey;
    const persisted = Number(persistedVisual.planVersion ?? 0) <= VISUAL_PLAN_VERSION ? safePlan(persistedVisual.plan) : [];
    const legacy = safePlan(persistedVisual.plan);
    const planBodyItemCount = legacy.filter((item) => item.role === 'BODY' || item.role === 'CARD').length;
    const hasSavedCount = Number.isInteger(persistedVisual.bodyItemCount) && Number(persistedVisual.bodyItemCount) >= countRange.min && Number(persistedVisual.bodyItemCount) <= countRange.max;
    const nextMode: QuantityMode = persistedVisual.quantityMode === 'AUTO' || persistedVisual.quantityMode === 'MANUAL'
      ? persistedVisual.quantityMode
      : legacy.length ? 'MANUAL' : 'AUTO';
    const nextCount = nextMode === 'MANUAL' && hasSavedCount
      ? Number(persistedVisual.bodyItemCount)
      : planBodyItemCount || recommendedBodyItemCount(platform, draft.body);
    const quantityNeedsRefresh = nextMode === 'MANUAL' && persisted.length > 0 && planBodyItemCount !== nextCount;
    const nextStyleProfile = { preset: persistedVisual.styleProfile?.preset ?? 'FRESH_EDITORIAL' as const, customPrompt: persistedVisual.styleProfile?.customPrompt ?? '' };
    setPlan((current) => JSON.stringify(current) === JSON.stringify(persisted) ? current : persisted);
    setBodyItemCount(nextCount);
    setQuantityMode(nextMode);
    setStyleProfile((current) => JSON.stringify(current) === JSON.stringify(nextStyleProfile) ? current : nextStyleProfile);
    setActiveItemId((current) => !switchedProject && persisted.some((item) => item.id === current) ? current : persisted[0]?.id ?? '');
    if (switchedProject) {
      setSearchQuery(persisted[0]?.searchQueries[0] ?? '');
      setSearchResults([]);
      setSearchAttempted(false);
      setSearchProvider('');
      setSearchError('');
      setSourceView('search');
      setReferencePickerOpen(false);
      setPlanNeedsRefresh(quantityNeedsRefresh);
      setPlanningRoute(null);
    }
    hydratedProjectKey.current = projectKey;
    setHydratedPlanKey(projectKey);
    lastSavedSignature.current = persisted.length ? JSON.stringify({ plan: persisted, styleProfile: nextStyleProfile, quantityMode: nextMode, bodyItemCount: nextCount }) : '';
  }, [draft.id]);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  const persistVisual = (snapshot: VisualSnapshot, workflowStatus = persistedVisual.workflowStatus) => {
    const queued = saveQueue.current.catch(() => draftRef.current).then(async () => {
      const compiledPlan = snapshot.plan.map((item) => updateVisualPlanItem(item, {}, { platform, title: draftRef.current.title }, snapshot.styleProfile));
      let saved = await webDrafts.patch(draftRef.current.id, {
        revision: draftRef.current.revision,
        visualPlan: { planVersion: VISUAL_PLAN_VERSION, plan: compiledPlan, styleProfile: snapshot.styleProfile, quantityMode: snapshot.quantityMode, bodyItemCount: snapshot.bodyItemCount, ...(workflowStatus ? { workflowStatus } : {}) },
      });
      const seen = new Set<string>();
      const orderedAssets = compiledPlan.flatMap((item) => {
        if (!item.assetId || seen.has(item.assetId)) return [];
        seen.add(item.assetId);
        return [{ assetId: item.assetId, role: item.role }];
      });
      saved = await webDrafts.replaceAssets(saved.id, { revision: saved.revision, assets: orderedAssets });
      draftRef.current = saved;
      onDraftChange(saved);
      return saved;
    });
    saveQueue.current = queued;
    return queued;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    webCreative.materials(project.id).then((result) => {
      if (!cancelled) setAssets(result.assets);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取素材失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    const localAssets = visualAssets.filter((asset) => !fileUrls[asset.id]);
    if (!localAssets.length) return;
    void Promise.all(localAssets.map(async (asset) => {
      const blob = await webAssets.content(asset.id);
      return [asset.id, URL.createObjectURL(blob)] as const;
    })).then((items) => {
      if (cancelled) { items.forEach(([, url]) => URL.revokeObjectURL(url)); return; }
      const loaded = Object.fromEntries(items);
      fileUrlsRef.current = { ...fileUrlsRef.current, ...loaded };
      setFileUrls((current) => ({ ...current, ...loaded }));
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '素材预览加载失败。');
    });
    return () => { cancelled = true; };
  }, [visualAssets, fileUrls]);

  useEffect(() => () => {
    Object.values(fileUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    fileUrlsRef.current = {};
  }, []);

  useEffect(() => {
    if (!hasCopy || !plan.length) return;
    if (hydratedPlanKey !== `${project.id}:${platform}`) return;
    const signature = JSON.stringify({ plan, styleProfile, quantityMode, bodyItemCount });
    if (signature === lastSavedSignature.current) return;
    const revision = ++saveRevision.current;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void persistVisual({ plan, styleProfile, quantityMode, bodyItemCount }).then(() => {
        if (revision !== saveRevision.current) return;
        lastSavedSignature.current = signature;
        setSaveState('saved');
      }).catch((reason) => {
        if (revision !== saveRevision.current) return;
        setSaveState('error');
        setError(reason instanceof Error ? reason.message : '配图方案自动保存失败。');
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [bodyItemCount, hasCopy, hydratedPlanKey, plan, project.id, quantityMode, styleProfile]);

  const runSearch = async (query: string) => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    const revision = ++searchRevision.current;
    setSearchQuery(normalized);
    setSearchResults([]);
    setSearchBusy(true);
    setSearchAttempted(true);
    setSearchProvider('');
    setSearchError('');
    setError('');
    try {
      const result = await webCreative.searchImages(normalized);
      if (revision === searchRevision.current) {
        setSearchResults(result.results);
        setSearchProvider(result.provider);
      }
    } catch (reason) {
      if (revision === searchRevision.current) setSearchError(reason instanceof Error ? reason.message : '搜索图片失败。');
    } finally {
      if (revision === searchRevision.current) setSearchBusy(false);
    }
  };

  const selectPlanItem = (item: CreativeVisualPlanItem) => {
    setActiveItemId(item.id);
    setSearchQuery(item.searchQueries[0] ?? '');
    setSearchResults([]);
    setSearchAttempted(false);
    setSearchProvider('');
    setSearchError('');
    setNotice('');
    setReferencePickerOpen(false);
  };

  const updateActiveItem = (patch: Partial<CreativeVisualPlanItem>) => {
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
    setNotice(plan.length ? '项目艺术方向已更新。点击“更新方案”后应用到全部图片。' : '项目艺术方向已更新。');
  };

  const addReference = (reference: ProjectAsset) => {
    if (!activeItem || activeItem.references.some((item) => item.assetId === reference.id) || activeItem.references.length >= 3) return;
    updateActiveItem({ references: [...activeItem.references, { assetId: reference.id, uses: ['COLOR', 'LAYOUT'] }] });
    setReferencePickerOpen(false);
  };

  const removeReference = (assetId: string) => {
    if (!activeItem) return;
    updateActiveItem({ references: activeItem.references.filter((item) => item.assetId !== assetId) });
  };

  const changeReferenceMode = (assetId: string, modeId: string) => {
    if (!activeItem) return;
    const uses = referenceModes.find((mode) => mode.id === modeId)?.uses ?? ['COLOR', 'LAYOUT'];
    updateActiveItem({ references: activeItem.references.map((item) => item.assetId === assetId ? { ...item, uses } : item) });
  };

  const assignAsset = (reference: ProjectAsset) => {
    setAssets((current) => current.some((item) => item.id === reference.id) ? current : [reference, ...current]);
    if (!activeItem) return;
    const previous = plan.find((item) => item.id !== activeItem.id && item.assetId === reference.id);
    setPlan((current) => current.map((item) => {
      if (item.id === activeItem.id) return { ...item, assetId: reference.id };
      if (previous && item.id === previous.id) return { ...item, assetId: null };
      return item;
    }));
    setNotice(previous ? `这张图已从“${previous.title}”移动到“${activeItem.title}”。` : '图片已绑定到当前配图位置。');
  };

  const importResult = async (result: ImageSearchResult) => {
    setImportingId(result.id); setError('');
    try {
      const existing = assets.find((item) => item.sourceUrl?.trim() === result.imageUrl.trim());
      if (existing) { assignAsset(existing); return; }
      const imported = await webAssets.import({ title: result.title, url: result.imageUrl, sourceNote: `${result.attribution}｜许可：${result.license}｜来源：${result.sourceUrl}`, copyrightStatus: result.copyrightStatus });
      const linked = await webAssets.link(project.id, imported.asset.id, { role: 'VISUAL', scope: 'IMAGING', title: imported.asset.title, notes: imported.asset.sourceNote, platforms: [platform] });
      assignAsset(linked);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入图片失败。'); }
    finally { setImportingId(null); }
  };

  const generate = async () => {
    if (!activeItem || activePrompt.length < 4) return;
    setGenerateBusy(true); setError('');
    try {
      const { projectAsset } = await webCreative.generateImage(project.id, {
        platform: 'WECHAT', visualItemId: activeItem.id,
        assetIds: activeItem.references.map((item) => item.assetId),
      });
      assignAsset(projectAsset);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 生图失败。'); }
    finally { setGenerateBusy(false); }
  };

  const save = async () => {
    setBusy('save'); setError('');
    try {
      await persistVisual({ plan, styleProfile, quantityMode, bodyItemCount });
      lastSavedSignature.current = JSON.stringify({ plan, styleProfile, quantityMode, bodyItemCount });
      setSaveState('saved');
    } catch (reason) { setSaveState('error'); setError(reason instanceof Error ? reason.message : '保存配图方案失败。'); }
    finally { setBusy(null); }
  };

  const complete = async () => {
    if (!hasCopy) { setError('请先完成当前渠道正文，再确认配图进入排版。'); return; }
    setBusy('complete'); setError('');
    try {
      await persistVisual({ plan, styleProfile, quantityMode, bodyItemCount }, 'COMPLETE');
      lastSavedSignature.current = JSON.stringify({ plan, styleProfile, quantityMode, bodyItemCount });
      onContinue();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认配图失败。'); }
    finally { setBusy(null); }
  };

  const planWithAI = async (currentItemId?: string, request = '') => {
    if (!hasCopy || planBusy) return;
    setPlanBusy(true); setError(''); setNotice('');
    try {
      const result = await webCreative.planVisual(project.id, {
        platform: 'WECHAT',
        quantityMode,
        ...(quantityMode === 'MANUAL' ? { bodyItemCount } : {}),
        styleProfile,
        request,
        currentItemId,
        currentPlan: plan,
        keepAssignedAssets: true,
      });
      const next = safePlan(result.plan);
      setPlan(next);
      setBodyItemCount(result.bodyItemCount);
      setPlanningRoute({ scope: result.policy.scope, provider: result.policy.provider, model: result.policy.model });
      setPlanNeedsRefresh(false);
      setActiveItemId((current) => currentItemId && next.some((item) => item.id === currentItemId) ? currentItemId : next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
      const selected = currentItemId ? next.find((item) => item.id === currentItemId) : next[0];
      setSearchQuery(selected?.searchQueries[0] ?? '');
      setSearchResults([]);
      setSearchAttempted(false);
      setSearchProvider('');
      setSearchError('');
      setItemRequest('');
      setNotice(currentItemId ? '这一张已按修改意见重新策划。' : `配图方案已由“配图策划”任务策略完成，共 ${next.length} 张。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成配图方案失败。');
    } finally {
      setPlanBusy(false);
    }
  };

  const changeBodyItemCount = (requested: number) => {
    const target = Math.max(countRange.min, Math.min(countRange.max, requested));
    if (target === bodyItemCount) return;
    setBodyItemCount(target);
    if (plan.length) setPlanNeedsRefresh(true);
    setNotice(plan.length ? '图片数量已调整。点击“更新方案”后重新安排位置。' : '');
  };

  const changeQuantityMode = (nextMode: QuantityMode) => {
    if (nextMode === quantityMode) return;
    setQuantityMode(nextMode);
    if (plan.length) setPlanNeedsRefresh(true);
    setNotice(plan.length ? nextMode === 'AUTO' ? '已改为自动规划数量。点击“更新方案”后，Agent 将按正文重新决定数量。' : '已改为手动指定数量。选择数量后点击“更新方案”。' : '');
  };

  const actualBodyItemCount = plan.filter((item) => item.role === 'BODY').length;
  const planCountSummary = quantityMode === 'AUTO'
    ? plan.length ? `自动规划｜封面 1 张，正文插图 ${actualBodyItemCount} 张` : '自动规划数量｜封面 1 张，正文插图由 Agent 决定'
    : `手动指定｜封面 1 张，正文插图 ${bodyItemCount} 张`;

  const assetSrc = (asset: ProjectAsset | undefined) => asset ? fileUrls[asset.id] : undefined;

  return <section className="visual-workspace">
    <header className="delivery-workspace-head visual-workspace-head">
      <div><h2>公众号配图</h2><p>{planCountSummary}｜任务策略：公众号配图策划（WECHAT_VISUAL_PLANNING）</p></div>
      <div className="visual-plan-actions">
        <button className="visual-project-style" type="button" aria-label="设置项目艺术方向" onClick={openStyleDialog}><Palette size={15}/><span>艺术方向</span><b>{allVisualStyles.find((style) => style.id === styleProfile.preset)?.name ?? visualStyles[0].name}</b></button>
        <div className="visual-quantity-control">
          <label className="visual-auto-quantity"><input type="checkbox" checked={quantityMode === 'AUTO'} onChange={(event) => changeQuantityMode(event.target.checked ? 'AUTO' : 'MANUAL')}/><span>自动规划数量</span></label>
          {quantityMode === 'MANUAL' && <label className="visual-manual-quantity"><span>正文插图</span><select aria-label="正文插图数量" value={bodyItemCount} onChange={(event) => changeBodyItemCount(Number(event.target.value))}>{Array.from({ length: countRange.max - countRange.min + 1 }, (_, index) => countRange.min + index).map((count) => <option value={count} key={count}>{count} 张</option>)}</select></label>}
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
          const asset = item.assetId ? visualAssets.find((candidate) => candidate.id === item.assetId) : undefined;
          const src = assetSrc(asset);
          return <button type="button" className={`visual-plan-item${item.id === activeItem?.id ? ' active' : ''}`} key={item.id} onClick={() => selectPlanItem(item)}>
            <span className="visual-plan-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="visual-plan-thumb">{src ? <img src={src} alt=""/> : <Image size={18}/>}</span>
            <span className="visual-plan-copy"><b>{item.title}</b><small>{item.placement}</small></span>
            <span className={`visual-plan-state${item.assetId ? ' done' : ''}`}>{item.assetId ? '已绑定' : '待选图'}</span>
          </button>;
        })}</div>
      </aside>

      {activeItem && <main className="visual-task-panel">
        <header className="visual-task-head">
          <div><span>{roleName(activeItem.role)} / {visualTypeName(activeItem.visualType)} / {activeItem.placement}</span><h3>{activeItem.title}</h3></div>
          {assignedAsset && <div className="visual-assigned-asset"><Check size={17}/><span><b>已绑定</b><small>{assignedAsset.title}</small></span><button type="button" title="移除当前配图" onClick={() => updateActiveItem({ assetId: null })}><Trash2 size={15}/></button></div>}
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
          <div className="visual-query-chips">{activeItem.searchQueries.map((query) => <button type="button" className={query === searchQuery ? 'active' : ''} aria-pressed={query === searchQuery && searchAttempted} disabled={searchBusy} key={query} onClick={() => void runSearch(query)}>{query}</button>)}</div>
          <form className="visual-search-form" onSubmit={(event) => { event.preventDefault(); void runSearch(searchQuery); }}>
            <label><span>搜索词</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
            <button className="button primary" type="submit" disabled={searchBusy || searchQuery.trim().length < 2}>{searchBusy ? <LoaderCircle size={16}/> : <Search size={16}/>}搜索</button>
          </form>
          {searchBusy && <div className="visual-result-state" role="status"><LoaderCircle size={18}/>正在搜索“{searchQuery}”</div>}
          {!searchBusy && searchError && <div className="visual-result-state error" role="alert">{searchError}</div>}
          {!searchBusy && searchAttempted && !searchError && searchResults.length === 0 && <div className="visual-result-state">没有找到与“{searchQuery}”匹配的图片，请换一个具体主体或场景。</div>}
          {!searchBusy && !searchAttempted && <div className="visual-result-state">点击推荐词会立即搜索，也可以输入关键词后搜索</div>}
          {!searchBusy && searchResults.length > 0 && <div className="visual-search-summary" role="status">{searchProvider} · {searchResults.length} 张候选图</div>}
          {searchResults.length > 0 && <div className="visual-search-grid">{searchResults.map((result) => <article className="visual-search-card" key={result.id}>
            <button className="visual-search-preview-button" type="button" onClick={() => setPreviewAsset({ id: '', kind: 'IMAGE', origin: 'WEB_IMPORT', status: 'ACTIVE', title: result.title, originalFilename: result.title, mimeType: 'image/jpeg', sizeBytes: 0, sha256: '', sourceUrl: result.imageUrl, sourceNote: result.sourceUrl, copyrightStatus: result.copyrightStatus, projectCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })}><img src={result.thumbnailUrl} alt=""/></button><div><b>{result.title}</b><small>{result.license}</small></div>
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
                <header><b>参考图</b><button className="text-button" type="button" disabled={activeItem.references.length >= 3 || !visualAssets.length} onClick={() => setReferencePickerOpen((open) => !open)}><Plus size={14}/>添加参考图</button></header>
                {referenceAssets.length > 0 && <div className="visual-reference-list">{referenceAssets.map(({ config, asset }) => asset && <article key={config.assetId}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <span><Image size={16}/></span>}<b>{asset.title}</b><select aria-label="参考方式" value={referenceModeValue(config.uses)} onChange={(event) => changeReferenceMode(config.assetId, event.target.value)}>{referenceModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.name}</option>)}</select><button type="button" title={`移除参考图 ${asset.title}`} onClick={() => removeReference(config.assetId)}><X size={14}/></button></article>)}</div>}
                {referencePickerOpen && <div className="visual-reference-picker">{visualAssets.filter((asset) => !activeItem.references.some((item) => item.assetId === asset.id)).map((asset) => <button type="button" key={asset.id} onClick={() => addReference(asset)}>{assetSrc(asset) ? <img src={assetSrc(asset)} alt=""/> : <Image size={18}/>}<span>{asset.title}</span></button>)}</div>}
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
          <div className="visual-library-actions"><button className="button" type="button" onClick={() => setAssetPickerOpen(true)}><Upload size={15}/>从素材库选择</button></div>
          {loading ? <div className="visual-result-state"><LoaderCircle size={18}/>读取项目素材</div> : visualAssets.length ? <div className="visual-library-grid">{visualAssets.map((asset) => {
            const src = assetSrc(asset); const checked = activeItem.assetId === asset.id;
            return <article className={`visual-library-card${checked ? ' selected' : ''}`} key={asset.id}><button className="visual-library-preview" type="button" onClick={() => setPreviewAsset(asset)}>{src ? <img src={src} alt=""/> : <Image size={20}/>}</button><div><b>{asset.title}</b><small>{asset.origin === 'WEB_IMPORT' ? '网络图片' : asset.origin === 'AI_GENERATED' ? 'AI 生图' : '上传素材'}</small></div><button className="button" type="button" onClick={() => assignAsset(asset)}>{checked ? <><Check size={14}/>已用于此处</> : '用于此处'}</button></article>;
          })}</div> : <div className="visual-result-state"><Image size={20}/>还没有图片素材</div>}
        </section>}
      </main>}
    </div>}

    {plan.length > 0 && <footer className="delivery-workspace-footer"><span>{saveState === 'saving' ? '正在自动保存配图方案' : planningRoute ? `实际策略：公众号配图策划（${planningRoute.scope}） · ${planningRoute.provider} / ${planningRoute.model}` : boundCount ? `已绑定 ${boundCount}/${plan.length} 张图片｜策略：公众号配图策划（WECHAT_VISUAL_PLANNING）` : '策略：公众号配图策划（WECHAT_VISUAL_PLANNING）｜可从第一张开始选图'}</span><div><button className="text-button" type="button" onClick={onOpenModelSettings}>查看任务策略</button><button className="button" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16}/> : <Save size={16}/>}保存</button><button className="button primary" type="button" disabled={busy !== null || !hasCopy || planNeedsRefresh} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : null}确认素材，进入排版</button></div></footer>}

    {styleDialogOpen && <div className="visual-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setStyleDialogOpen(false); }}>
      <section className="visual-style-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-style-dialog-title">
        <header><div><h2 id="visual-style-dialog-title">项目艺术方向</h2><span>{visualStyles.length} 套全画幅视觉案例</span></div><button className="icon-button" type="button" aria-label="关闭艺术方向设置" onClick={() => setStyleDialogOpen(false)}><X size={18}/></button></header>
        <div className="visual-style-dialog-body">
          <nav className="visual-style-tabs" aria-label="艺术方向分类">{visualStyleGroups.map((group) => <button type="button" className={group.id === activeStyleGroup ? 'active' : ''} key={group.id} onClick={() => setActiveStyleGroup(group.id)}><span>{group.name}</span><small>{group.styles.length}</small></button>)}</nav>
          <div className="visual-style-browser">
            <section className="visual-style-gallery" aria-label={visibleStyleGroup.name + '艺术方向'}>
              {visibleStyleGroup.styles.map((style) => <button aria-label={style.name + '：' + style.description} className={'visual-style-card' + (styleDraft.preset === style.id ? ' active' : '')} type="button" key={style.id} onClick={() => setStyleDraft((current) => ({ ...current, preset: style.id }))}><VisualStylePreview style={style}/><span className="visual-style-card-copy"><b>{style.name}</b><small>{style.description}</small></span>{styleDraft.preset === style.id && <span className="visual-style-selected"><Check size={13}/>已选</span>}</button>)}
            </section>
            <aside className="visual-style-inspector">
              <VisualStylePreview style={selectedStyle} large/>
              <div className="visual-style-inspector-head"><div><b>{selectedStyle.name}</b><span>{selectedStyle.description}</span></div><span className="visual-style-palette" aria-label="方向配色">{selectedStyle.swatches.map((color) => <i key={color} style={{ background: color }}/>)}</span></div>
              <label className="visual-style-custom"><span>统一补充要求</span><textarea maxLength={1200} value={styleDraft.customPrompt ?? ''} onChange={(event) => setStyleDraft((current) => ({ ...current, customPrompt: event.target.value }))} placeholder="可补充品牌色、构图偏好、参考质感或必须保留的视觉元素"/><small>{styleDraft.customPrompt?.length ?? 0}/1200</small></label>
            </aside>
          </div>
        </div>
        <footer><span>当前选择：<b>{selectedStyle.name}</b></span><button className="button" type="button" onClick={() => setStyleDialogOpen(false)}>取消</button><button className="button primary" type="button" onClick={applyProjectStyle}>应用到项目</button></footer>
      </section>
    </div>}

    {previewAsset && <AssetPreviewDialog asset={previewAsset} externalUrl={previewAsset.id ? undefined : previewAsset.sourceUrl ?? undefined} onClose={() => setPreviewAsset(null)}/>} 
    {assetPickerOpen && <AssetPickerDialog projectId={project.id} role="VISUAL" scope="IMAGING" platforms={[platform]} imageOnly excludedAssetIds={visualAssets.map((asset) => asset.id)} onLinked={(asset) => { setAssets((current) => [asset, ...current]); assignAsset(asset); }} onClose={() => setAssetPickerOpen(false)}/>}
  </section>;
}
