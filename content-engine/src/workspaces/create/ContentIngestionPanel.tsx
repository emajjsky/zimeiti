import { CheckCircle2, ExternalLink, FileText, Image, Link2, LoaderCircle, Sparkles, Upload, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webAssets, webCreative, webIngestions, webModels } from '../../data/webApi';
import type { WorkspaceAsset } from '../../domain/assets';
import type { ContentProject, Platform } from '../../domain/content';
import { platformName } from '../../domain/content';
import type { ContentIngestion, ContentIngestionIntent } from '../../domain/content-ingestion';

type Mode = 'ZERO' | 'REFERENCE' | 'EXISTING' | 'VIDEO';
type Maturity = 'IDEA' | 'OUTLINE' | 'FRAGMENTS' | 'PARTIAL_DRAFT' | 'FULL_DRAFT';
const MAX_SELECTED_ASSETS = 9;

const maturityOptions: Array<{ id: Maturity; label: string; description: string }> = [
  { id: 'IDEA', label: '个人创意', description: '题材、观点或一句想法' },
  { id: 'OUTLINE', label: '大纲', description: '章节、要点或写作结构' },
  { id: 'FRAGMENTS', label: '零散片段', description: '尚未整理成完整正文' },
  { id: 'PARTIAL_DRAFT', label: '半成稿', description: '已有连续正文，需要补全' },
  { id: 'FULL_DRAFT', label: '完整草稿', description: '直接进入正文编辑器' },
];

const usages = [
  ['TOPIC', '题材'], ['ANGLE', '角度'], ['STRUCTURE', '结构'], ['STYLE', '表达规则'], ['FACT_LEADS', '事实线索'], ['VISUAL', '画面参考'],
] as const;

const activeStages = new Set(['PENDING', 'FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING']);

function statusLabel(ingestion: ContentIngestion | null) {
  if (!ingestion) return '';
  if (activeStages.has(ingestion.stage)) {
    if (ingestion.stage === 'FETCHING') return '正在读取来源';
    if (ingestion.stage === 'PARSING') return '正在整理正文结构';
    if (ingestion.stage === 'DOWNLOADING_MEDIA') return '正在整理图片候选';
    if (ingestion.stage === 'ANALYZING') return '正在理解内容';
    return '正在准备导入任务';
  }
  if (ingestion.stage === 'READY') return '内容已读取，请确认后创建项目';
  if (ingestion.stage === 'PARTIAL') return '内容部分读取成功，请确认可用部分';
  if (ingestion.stage === 'NEEDS_USER_INPUT') return '需要打开原文完成验证，或改为粘贴正文';
  if (ingestion.stage === 'CANCELLED') return '读取已取消';
  return ingestion.errorMessage || '内容读取失败，请修改输入后重试';
}

export function ContentIngestionPanel({ onClose, onCreateProject, onDeleteProject, onProjectCreated }: {
  onClose: () => void;
  onCreateProject: (input: { originType: 'MANUAL'; title: string; category: string; targetPlatforms: Platform[] }) => Promise<ContentProject>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onProjectCreated: (project: ContentProject) => void;
}) {
  const [mode, setMode] = useState<Mode>('ZERO');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<WorkspaceAsset[]>([]);
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [assetUploading, setAssetUploading] = useState(false);
  const [maturity, setMaturity] = useState<Maturity>('FULL_DRAFT');
  const [selectedUsages, setSelectedUsages] = useState<string[]>(['STRUCTURE', 'ANGLE']);
  const [targetPlatforms, setTargetPlatforms] = useState<Platform[]>(['WECHAT']);
  const [ingestion, setIngestion] = useState<ContentIngestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoMetadata, setVideoMetadata] = useState({ duration: 0, width: 0, height: 0 });
  const videoPreviewUrl = useMemo(() => videoFile ? URL.createObjectURL(videoFile) : '', [videoFile]);

  useEffect(() => () => { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); }, [videoPreviewUrl]);

  useEffect(() => {
    if (!ingestion || !activeStages.has(ingestion.stage)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void webIngestions.get(ingestion.id).then((next) => { if (active) setIngestion(next); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '读取导入状态失败'); });
    }, 900);
    return () => { active = false; window.clearTimeout(timer); };
  }, [ingestion]);

  const togglePlatform = (platform: Platform) => setTargetPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  const toggleUsage = (usage: string) => setSelectedUsages((current) => current.includes(usage) ? current.filter((item) => item !== usage) : [...current, usage]);
  const setModeAndReset = (next: Mode) => { setMode(next); setError(''); setIngestion(null); setSelectedAssets([]); setVideoFile(null); };

  const toggleAsset = (asset: WorkspaceAsset) => {
    setIngestion(null);
    setSelectedAssets((current) => {
      if (current.some((item) => item.id === asset.id)) return current.filter((item) => item.id !== asset.id);
      if (current.length >= MAX_SELECTED_ASSETS) { setError(`最多选择 ${MAX_SELECTED_ASSETS} 个素材。`); return current; }
      setError('');
      return [...current, asset];
    });
  };

  useEffect(() => {
    if (mode !== 'EXISTING') return;
    let active = true;
    setAssetsLoading(true);
    void webAssets.list({ status: 'ACTIVE' }).then(({ assets: listed }) => {
      if (active) setAssets(listed);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取素材库失败');
    }).finally(() => {
      if (active) setAssetsLoading(false);
    });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setAssetPreviewUrls({});
    void Promise.allSettled(assets.filter((asset) => asset.kind === 'IMAGE').map(async (asset) => {
      const url = URL.createObjectURL(await webAssets.content(asset.id));
      if (!active) { URL.revokeObjectURL(url); return null; }
      urls.push(url);
      return [asset.id, url] as const;
    })).then((results) => {
      if (!active) return;
      setAssetPreviewUrls(Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])));
    });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [assets]);

  const uploadAssets = async (files: File[]) => {
    const remaining = MAX_SELECTED_ASSETS - selectedAssets.length;
    if (remaining <= 0) { setError(`最多选择 ${MAX_SELECTED_ASSETS} 个素材。`); return; }
    const accepted = files.slice(0, remaining);
    setAssetUploading(true);
    setError(files.length > remaining ? `已按上限选择前 ${remaining} 个文件。` : '');
    try {
      const uploaded: WorkspaceAsset[] = [];
      for (const file of accepted) uploaded.push((await webAssets.upload(file, { title: file.name })).asset);
      setAssets((current) => [...uploaded, ...current.filter((item) => !uploaded.some(({ id }) => id === item.id))]);
      setSelectedAssets((current) => [...current, ...uploaded].slice(0, MAX_SELECTED_ASSETS));
      setIngestion(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传素材失败');
    } finally {
      setAssetUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!targetPlatforms.length) { setError('请至少选择一个目标平台。'); return; }
    setBusy(true);
    setError('');
    try {
      if (mode === 'ZERO') {
        const project = await onCreateProject({ originType: 'MANUAL', title: title.trim(), category: category.trim(), targetPlatforms });
        onProjectCreated(project);
        onClose();
        return;
      }
      if (mode === 'VIDEO') {
        if (!videoFile) throw new Error('请选择要拉片的视频文件。');
        const policies = await webModels.taskPolicies();
        const videoPolicy = policies.find((policy) => policy.task === 'VIDEO_ANALYSIS');
        const videoModel = videoPolicy?.model?.trim() ?? '';
        const supportsVideoAnalysis = videoPolicy?.provider === 'BAILIAN_CLI'
          && /^qwen3\.[6-8](?:[-_.]|$)/i.test(videoModel)
          && !/(?:omni|embedding|rerank)/i.test(videoModel);
        if (!supportsVideoAnalysis) {
          throw new Error('尚未配置视频拉片模型。请先到“设置 > 模型任务策略”为“视频拉片”选择 Qwen 3.6 至 3.8 系列模型。');
        }
        const uploaded = await webAssets.upload(videoFile, { title: videoFile.name });
        let project: ContentProject | null = null;
        try {
          if (uploaded.asset.kind !== 'VIDEO') throw new Error('视频拉片只接受 MP4 或 WebM 视频文件。');
          project = await onCreateProject({ originType: 'MANUAL', title: title.trim() || '视频拉片项目', category: category.trim(), targetPlatforms });
          await webCreative.startVideoAnalysis(project.id, { assetId: uploaded.asset.id, targetPlatform: targetPlatforms[0] as 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO' });
          onProjectCreated(project);
          onClose();
        } catch (reason) {
          await Promise.allSettled([
            ...(project ? [onDeleteProject(project.id)] : []),
            webAssets.remove(uploaded.asset.id),
          ]);
          throw reason;
        }
        return;
      }
      if (ingestion && ['READY', 'PARTIAL'].includes(ingestion.stage)) {
        const applied = await webIngestions.apply(ingestion.id, { originType: mode === 'REFERENCE' ? 'IMPORT' : 'DRAFT', title: title.trim(), category: category.trim(), targetPlatforms, maturity: mode === 'REFERENCE' ? undefined : maturity });
        onProjectCreated(applied.project);
        onClose();
        return;
      }
      const intent: ContentIngestionIntent = mode === 'REFERENCE' ? 'REFERENCE' : 'AUTHOR_CONTENT';
      const input = mode === 'REFERENCE'
        ? { kind: 'URL' as const, url: url.trim() }
        : { kind: 'COMPOSITE' as const, text: text.trim(), maturity, assetIds: selectedAssets.map((asset) => asset.id) };
      const created = await webIngestions.create({ input, intent, usage: mode === 'REFERENCE' ? (selectedUsages as typeof usages[number][0][]) : [] });
      setIngestion({ ...created.ingestion, media: created.ingestion.media ?? [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建内容项目失败。');
    } finally {
      setBusy(false);
    }
  };

  const cancelReading = async () => {
    if (!ingestion) return;
    setBusy(true);
    setError('');
    try { setIngestion(await webIngestions.cancel(ingestion.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消读取失败'); }
    finally { setBusy(false); }
  };

  const ready = Boolean(ingestion && ['READY', 'PARTIAL'].includes(ingestion.stage));
  const readingActive = Boolean(ingestion && activeStages.has(ingestion.stage));
  const imageAssets = useMemo(() => assets.filter((asset) => asset.kind === 'IMAGE'), [assets]);
  const fileAssets = useMemo(() => assets.filter((asset) => asset.kind !== 'IMAGE'), [assets]);
  const imageColumns = useMemo(() => {
    const columns: WorkspaceAsset[][] = [[], [], []];
    imageAssets.forEach((asset, index) => columns[index % columns.length].push(asset));
    return columns;
  }, [imageAssets]);
  return <form className="creative-project-create content-ingestion-panel" onSubmit={submit}>
    <header><div><span className="eyebrow">CREATE / CONTENT INGESTION</span><h2>新建创作</h2><p>先说明你手里的内容，再决定如何开始创作。</p></div>{!readingActive && <button className="icon-button" type="button" aria-label="关闭新建创作" onClick={onClose}><X size={18}/></button>}</header>
    <nav className="content-ingestion-intents" aria-label="创作意图">
      <button type="button" className={mode === 'ZERO' ? 'active' : ''} onClick={() => setModeAndReset('ZERO')}><Sparkles size={18}/><b>从零创作</b><small>只有题材和想法</small></button>
      <button type="button" className={mode === 'REFERENCE' ? 'active' : ''} onClick={() => setModeAndReset('REFERENCE')}><Link2 size={18}/><b>参考内容创作</b><small>读取公开文章或网页</small></button>
      <button type="button" className={mode === 'EXISTING' ? 'active' : ''} onClick={() => setModeAndReset('EXISTING')}><FileText size={18}/><b>继续已有内容</b><small>大纲、片段或完整草稿</small></button>
      <button type="button" className={mode === 'VIDEO' ? 'active' : ''} onClick={() => setModeAndReset('VIDEO')}><Video size={18}/><b>视频拉片</b><small>上传视频，拆解内容并提取关键帧</small></button>
    </nav>
    <div className="creative-create-fields">
      <label><span>项目标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可以先写一个工作标题" autoFocus /></label>
      <label><span>题材</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如 AI、财经、历史" /></label>
      {mode === 'REFERENCE' && <><label className="wide"><span>公开链接</span><input type="url" value={url} onChange={(event) => { setUrl(event.target.value); setIngestion(null); }} placeholder="公众号、新闻、知乎、X 或其他公开网页链接" required /></label><fieldset className="wide"><legend>我希望参考什么</legend><div className="content-ingestion-checks">{usages.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedUsages.includes(id)} onChange={() => toggleUsage(id)}/><span>{label}</span></label>)}</div></fieldset></>}
      {mode === 'EXISTING' && <><fieldset className="wide"><legend>内容成熟度</legend><div className="content-ingestion-maturity">{maturityOptions.map((item) => <button type="button" key={item.id} className={maturity === item.id ? 'active' : ''} onClick={() => setMaturity(item.id)}><b>{item.label}</b><small>{item.description}</small></button>)}</div></fieldset><label className="wide"><span>粘贴已有内容</span><textarea rows={8} value={text} onChange={(event) => { setText(event.target.value); setIngestion(null); }} placeholder="粘贴大纲、零散片段、半成稿或完整正文" required={!selectedAssets.length} /></label><div className="wide content-ingestion-asset-source"><div className="content-ingestion-asset-toolbar"><div><strong>补充素材</strong><small>已选 {selectedAssets.length}/{MAX_SELECTED_ASSETS}</small></div><label className="button"><Upload size={15} />上传文件<input hidden multiple type="file" accept="image/*,.pdf,.doc,.docx,.txt,.md,audio/*,video/*" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) void uploadAssets(files); }} /></label></div>{assetsLoading ? <div className="content-ingestion-asset-empty"><LoaderCircle className="spin" size={16} />读取素材库</div> : assets.length ? <>{imageAssets.length > 0 && <div className="content-ingestion-asset-waterfall">{imageColumns.map((column, columnIndex) => <div key={columnIndex}>{column.map((asset) => { const selected = selectedAssets.some((item) => item.id === asset.id); return <button type="button" key={asset.id} className={selected ? 'active' : ''} aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${asset.title || asset.originalFilename}`} onClick={() => toggleAsset(asset)}>{assetPreviewUrls[asset.id] ? <img src={assetPreviewUrls[asset.id]} alt={asset.title || asset.originalFilename} loading="lazy" /> : <Image size={24} />}{selected && <span className="content-ingestion-asset-selected"><CheckCircle2 size={16} /></span>}</button>; })}</div>)}</div>}{fileAssets.length > 0 && <div className="content-ingestion-file-list">{fileAssets.map((asset) => { const selected = selectedAssets.some((item) => item.id === asset.id); return <button type="button" key={asset.id} className={selected ? 'active' : ''} aria-pressed={selected} onClick={() => toggleAsset(asset)}><FileText size={18} /><span><b>{asset.title || asset.originalFilename}</b><small>{asset.kind} · {Math.ceil(asset.sizeBytes / 1024)} KB</small></span>{selected && <CheckCircle2 size={16}/>}</button>; })}</div>}</> : <div className="content-ingestion-asset-empty">素材库暂无可用文件</div>}{assetUploading && <div className="content-ingestion-asset-empty"><LoaderCircle className="spin" size={16} />正在上传素材</div>}</div></>}
      {mode === 'VIDEO' && <div className="wide video-analysis-upload"><label className="video-analysis-drop"><Upload size={20}/><b>{videoFile ? '更换视频' : '选择视频文件'}</b><small>支持 MP4、WebM，单文件不超过 1GB；长视频会按内容分段拉片</small><input hidden type="file" accept="video/mp4,video/webm" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; setVideoFile(file); setVideoMetadata({ duration: 0, width: 0, height: 0 }); }}/></label>{videoFile && <section className="video-analysis-preview"><video src={videoPreviewUrl} controls preload="metadata" onLoadedMetadata={(event) => setVideoMetadata({ duration: event.currentTarget.duration, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}/><div><b>{videoFile.name}</b><span>{videoMetadata.duration ? `${Math.round(videoMetadata.duration)} 秒 · ` : ''}{videoMetadata.width ? `${videoMetadata.width}×${videoMetadata.height} · ` : ''}{(videoFile.size / 1024 / 1024).toFixed(1)} MB</span></div></section>}</div>}
      <fieldset className="wide"><legend>目标平台</legend><div className="content-ingestion-checks">{(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO'] as Platform[]).map((platform) => <label key={platform}><input type="checkbox" checked={targetPlatforms.includes(platform)} onChange={() => togglePlatform(platform)}/><span>{platformName[platform]}</span></label>)}</div></fieldset>
    </div>
    {ingestion && <div className={`content-ingestion-status status-${ingestion.stage.toLowerCase()}`} role="status">{activeStages.has(ingestion.stage) ? <LoaderCircle className="spin" size={17}/> : ready ? <CheckCircle2 size={17}/> : null}<span>{statusLabel(ingestion)}</span><small>处理类型：{({ TEXT: '文本内容', DOCUMENT: '文档内容', MULTIMODAL: '多模态内容' } as Record<string, string>)[ingestion.processingKind] ?? ingestion.processingKind}</small>{ingestion.document && <small>{ingestion.document.plainText.length.toLocaleString('zh-CN')} 字 · {ingestion.document.blocks.length} 个内容块 · {(ingestion.media ?? []).length} 个媒体素材</small>}</div>}
    {ingestion?.document && ready && <section className="content-ingestion-preview" aria-label="规范化内容预览"><header><div><span className="eyebrow">NORMALIZED DOCUMENT</span><h3>读取结果确认</h3></div>{ingestion.canonicalUrl && <a href={ingestion.canonicalUrl} target="_blank" rel="noreferrer">打开原文 <ExternalLink size={14}/></a>}</header><div className="content-ingestion-blocks">{ingestion.document.blocks.slice(0, 12).map((block) => <article key={block.id} className={`ingestion-block ingestion-block-${block.type}`}>{block.type === 'heading' ? <h4>{block.text}</h4> : block.type === 'quote' ? <blockquote>{block.text}</blockquote> : block.type === 'list' ? <ul>{(block.items ?? []).map((item) => <li key={item}>{item}</li>)}</ul> : block.type === 'image' || block.type === 'embed' ? <span className="ingestion-image-marker"><Image size={15}/>媒体素材</span> : <p>{block.text}</p>}</article>)}</div>{(ingestion.media ?? []).length > 0 && <div className="content-ingestion-media"><h4>正文媒体</h4><div className="content-ingestion-media-grid">{(ingestion.media ?? []).map((item) => <figure key={item.id}>{item.mediaType === 'VIDEO' ? <video src={item.resolvedUrl} controls preload="metadata"/> : item.mediaType === 'AUDIO' ? <audio src={item.resolvedUrl} controls preload="metadata"/> : <img src={item.resolvedUrl} alt={item.altText} loading="lazy" referrerPolicy="no-referrer"/>}<figcaption>{item.mediaType === 'IMAGE' ? '正文图片' : item.mediaType === 'VIDEO' ? '正文视频' : '正文音频'}</figcaption></figure>)}</div></div>}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer>{readingActive && <button className="button" type="button" disabled={busy} onClick={() => void cancelReading()}>停止读取</button>}<button className="button primary" disabled={busy || readingActive || (mode === 'VIDEO' && !videoFile)} type="submit">{busy && <LoaderCircle className="spin" size={16}/>} {mode === 'ZERO' ? '创建项目' : mode === 'VIDEO' ? '创建并开始拉片' : ready ? '确认并创建项目' : '读取内容'}</button></footer>
  </form>;
}
