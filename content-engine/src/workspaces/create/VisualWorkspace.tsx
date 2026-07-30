import { Check, Image, LoaderCircle, Save, Search, Sparkles, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform, ProjectReference } from '../../domain/creative';

type ImageSearchResult = { id: string; title: string; thumbnailUrl: string; imageUrl: string; sourceUrl: string; license: string; attribution: string };
type ImageSize = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

function usableVisualReference(item: ProjectReference) {
  return item.role === 'VISUAL' || item.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(item.url ?? '');
}

function defaultImageSize(platform: CreativePlatform): ImageSize {
  return platform === 'XIAOHONGSHU' ? '3:4' : platform === 'WEIBO' ? '1:1' : '16:9';
}

export function VisualWorkspace({ project, activePlatform, onProjectChange, onOpenModelSettings }: {
  project: ContentProject;
  activePlatform: CreativePlatform;
  onProjectChange: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
}) {
  const currentDelivery = project.delivery?.platforms?.[activePlatform];
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [selected, setSelected] = useState<string[]>(currentDelivery?.visual?.assetReferenceIds ?? []);
  const [cover, setCover] = useState<string | null>(currentDelivery?.visual?.coverReferenceId ?? null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [error, setError] = useState('');
  const [sourceView, setSourceView] = useState<'library' | 'search' | 'generate'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [imageSize, setImageSize] = useState<ImageSize>(() => defaultImageSize(activePlatform));
  const [generateBusy, setGenerateBusy] = useState(false);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const assets = useMemo(() => references.filter(usableVisualReference), [references]);
  const hasCopy = project.versions.some((item) => item.platform === activePlatform && String(item.body ?? '').trim().length >= 80);

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
    setSelected(currentDelivery?.visual?.assetReferenceIds ?? []);
    setCover(currentDelivery?.visual?.coverReferenceId ?? null);
    setImageSize(defaultImageSize(activePlatform));
  }, [activePlatform, currentDelivery?.visual?.assetReferenceIds, currentDelivery?.visual?.coverReferenceId]);

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
    }).catch(() => { /* 素材卡保留为无预览状态，错误不阻塞选图。 */ });
    return () => { cancelled = true; };
  }, [assets, fileUrls]);

  const addSelected = (reference: ProjectReference) => {
    setReferences((current) => current.some((item) => item.id === reference.id) ? current : [reference, ...current]);
    setSelected((current) => current.includes(reference.id) ? current : [...current, reference.id]);
    setCover((current) => current ?? reference.id);
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      if (!next.includes(cover ?? '')) setCover(next[0] ?? null);
      return next;
    });
  };

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const result = await webCreative.saveVisual(project.id, { platform: activePlatform, coverReferenceId: selected.includes(cover ?? '') ? cover : selected[0] ?? null, assetReferenceIds: selected });
      onProjectChange(result.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存配图失败。'); }
    finally { setBusy(null); }
  };

  const complete = async () => {
    if (!hasCopy) { setError('先完成当前渠道正文，再确认配图进入排版。'); return; }
    setBusy('complete'); setError('');
    try {
      const saved = await webCreative.saveVisual(project.id, { platform: activePlatform, coverReferenceId: selected.includes(cover ?? '') ? cover : selected[0] ?? null, assetReferenceIds: selected });
      const result = await webCreative.completeVisual(project.id, activePlatform);
      onProjectChange(result.project ?? saved.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认配图失败。'); }
    finally { setBusy(null); }
  };

  const search = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearchBusy(true); setError('');
    try { setSearchResults((await webCreative.searchImages(searchQuery.trim())).results); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '搜索图片失败。'); }
    finally { setSearchBusy(false); }
  };

  const importResult = async (result: ImageSearchResult) => {
    setImportingId(result.id); setError('');
    try {
      const reference = await webCreative.createReference(project.id, {
        title: result.title, url: result.imageUrl, role: 'VISUAL', scope: 'IMAGING', platforms: [activePlatform],
        notes: `Wikimedia Commons｜许可：${result.license}｜署名：${result.attribution}｜来源：${result.sourceUrl}`,
      });
      addSelected(reference); setSourceView('library');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入图片失败。'); }
    finally { setImportingId(null); }
  };

  const generate = async () => {
    if (imagePrompt.trim().length < 4) return;
    setGenerateBusy(true); setError('');
    try {
      const { reference } = await webCreative.generateImage(project.id, { platform: activePlatform, prompt: imagePrompt.trim(), size: imageSize, negativePrompt: negativePrompt.trim() || undefined });
      addSelected(reference); setImagePrompt(''); setNegativePrompt(''); setSourceView('library');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 生图失败。'); }
    finally { setGenerateBusy(false); }
  };

  return <section className="visual-workspace">
    <header className="delivery-workspace-head">
      <div><h2>{activePlatform === 'XIAOHONGSHU' ? '图文卡片素材' : `${platformName[activePlatform]}配图`}</h2><p>{hasCopy ? '选图后可确认进入排版，仍可随时返回正文修改。' : '正文还未完成，也可以先准备并保存配图。'}</p></div>
      <button className="button" type="button" onClick={() => setSourceView('library')}><Upload size={16}/>项目素材</button>
    </header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    <nav className="visual-source-tabs" aria-label="配图获取方式">
      <button type="button" className={sourceView === 'library' ? 'active' : ''} onClick={() => setSourceView('library')}><Image size={15}/>项目素材</button>
      <button type="button" className={sourceView === 'search' ? 'active' : ''} onClick={() => setSourceView('search')}><Search size={15}/>搜图</button>
      <button type="button" className={sourceView === 'generate' ? 'active' : ''} onClick={() => setSourceView('generate')}><Sparkles size={15}/>AI 生图</button>
    </nav>
    {sourceView === 'search' && <section className="visual-search-workspace">
      <form className="visual-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="输入要找的画面，例如：城市夜景、古籍书页"/><button className="button primary" type="submit" disabled={searchBusy || searchQuery.trim().length < 2}>{searchBusy ? <LoaderCircle size={16}/> : <Search size={16}/>}搜索</button></form>
      {searchResults.length > 0 && <div className="visual-search-grid">{searchResults.map((result) => <article className="visual-search-card" key={result.id}><img src={result.thumbnailUrl} alt=""/><div><b>{result.title}</b><small>{result.license}</small></div><footer><a href={result.sourceUrl} target="_blank" rel="noreferrer">来源</a><button className="button" type="button" disabled={importingId !== null} onClick={() => void importResult(result)}>{importingId === result.id ? <LoaderCircle size={15}/> : <Check size={15}/>}选用</button></footer></article>)}</div>}
    </section>}
    {sourceView === 'generate' && <section className="visual-generate-workspace">
      <label className="visual-prompt-field"><span>画面描述</span><textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="描述主体、场景、风格和需要留白的位置"/></label>
      <div className="visual-generate-controls"><label><span>比例</span><select value={imageSize} onChange={(event) => setImageSize(event.target.value as ImageSize)}><option value="1:1">1:1 方图</option><option value="3:4">3:4 竖图</option><option value="4:3">4:3 横图</option><option value="9:16">9:16 竖版</option><option value="16:9">16:9 横版</option></select></label><label><span>避免出现</span><input value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="可选"/></label><button className="button primary" type="button" disabled={generateBusy || imagePrompt.trim().length < 4} onClick={() => void generate()}>{generateBusy ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成图片</button></div>
      <button className="text-button visual-model-link" type="button" onClick={onOpenModelSettings}>文生图模型设置</button>
    </section>}
    {sourceView === 'library' && (loading ? <div className="delivery-loading"><LoaderCircle size={18}/>读取素材</div> : assets.length ? <div className="visual-asset-grid">
      {assets.map((asset) => {
        const checked = selected.includes(asset.id); const isCover = cover === asset.id && checked;
        const src = asset.url ?? fileUrls[asset.id];
        return <article className={`visual-asset-card${checked ? ' selected' : ''}`} key={asset.id}>
          <button className="visual-asset-main" type="button" onClick={() => toggle(asset.id)} aria-pressed={checked}>
            {src ? <img src={src} alt=""/> : <span className="visual-asset-icon"><Image size={22}/></span>}<span><b>{asset.title}</b><small>{asset.sourceType === 'FILE' ? '项目图片' : '网络图片'}</small></span>
          </button>
          {checked && <button className={`visual-cover-toggle${isCover ? ' active' : ''}`} type="button" onClick={() => setCover(asset.id)}>{isCover ? <><Check size={14}/>封面</> : '设为封面'}</button>}
        </article>;
      })}
    </div> : <section className="delivery-empty"><Image size={24}/><b>还没有可用图片</b><p>可搜索公开许可图片，或直接生成项目配图。</p></section>)}
    <footer className="delivery-workspace-footer"><span>{selected.length ? `已选 ${selected.length} 张${cover ? '，已设封面' : ''}` : '可先保存为空，之后再补图'}</span><div><button className="button" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16}/> : <Save size={16}/>}保存</button><button className="button primary" type="button" disabled={busy !== null || !hasCopy} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : null}确认素材，进入排版</button></div></footer>
  </section>;
}
