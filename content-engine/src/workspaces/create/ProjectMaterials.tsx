import { ExternalLink, FileAudio, FileText, FileVideo, Image, Link2, LoaderCircle, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webAssets, webCreative } from '../../data/webApi';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform, ProjectInput, ProjectInputKind, ProjectInputPayload, ProjectMaterialScope, ProjectReference, ProjectReferenceMetadata, ProjectReferenceRole } from '../../domain/creative';
import type { ProjectAsset } from '../../domain/assets';
import { AssetPreviewDialog } from '../../components/assets/AssetPreviewDialog';
import { AssetPickerDialog } from '../../components/assets/AssetPickerDialog';

type MaterialTab = 'INPUTS' | 'LINKS' | 'ASSETS';
type Editor = { type: 'INPUT'; item?: ProjectInput } | { type: 'LINK'; item?: ProjectReference } | { type: 'ASSET' };

const inputKinds: { id: ProjectInputKind; label: string }[] = [
  { id: 'IDEA', label: '想法' }, { id: 'DRAFT', label: '草稿' }, { id: 'NOTE', label: '笔记' }, { id: 'TRANSCRIPT', label: '转写' },
];
const referenceRoles: { id: ProjectReferenceRole; label: string }[] = [
  { id: 'FACT', label: '事实来源' }, { id: 'OPINION', label: '观点参考' }, { id: 'STRUCTURE', label: '结构参考' },
  { id: 'VOICE', label: '语言参考' }, { id: 'HOOK', label: '标题/钩子' }, { id: 'VISUAL', label: '视觉参考' }, { id: 'NEGATIVE', label: '反例' },
];
const materialScopes: { id: ProjectMaterialScope; label: string }[] = [
  { id: 'PROJECT', label: '全项目' }, { id: 'RESEARCH', label: '研究验证' }, { id: 'WRITING', label: '文案写作' }, { id: 'IMAGING', label: '配图制作' },
];
const inputKindName = Object.fromEntries(inputKinds.map((item) => [item.id, item.label])) as Record<ProjectInputKind, string>;
const referenceRoleName = Object.fromEntries(referenceRoles.map((item) => [item.id, item.label])) as Record<ProjectReferenceRole, string>;
const scopeName = Object.fromEntries(materialScopes.map((item) => [item.id, item.label])) as Record<ProjectMaterialScope, string>;

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <Image size={18}/>;
  if (mimeType.startsWith('audio/')) return <FileAudio size={18}/>;
  if (mimeType.startsWith('video/')) return <FileVideo size={18}/>;
  return <FileText size={18}/>;
}

function scopeText(scope: ProjectMaterialScope, platforms: CreativePlatform[]) {
  return `${scopeName[scope]} · ${platforms.length ? platforms.map((platform) => platformName[platform]).join('、') : '全部平台'}`;
}

export function ProjectMaterials({ project, platforms }: { project: ContentProject; platforms: CreativePlatform[] }) {
  const projectId = project.id;
  const [inputs, setInputs] = useState<ProjectInput[]>([]);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [tab, setTab] = useState<MaterialTab>('INPUTS');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewAsset, setPreviewAsset] = useState<ProjectAsset | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const links = useMemo(() => references.filter((item) => item.sourceType === 'LINK'), [references]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    webCreative.materials(projectId).then((result) => {
      if (cancelled) return;
      setInputs(result.inputs); setReferences(result.references); setAssets(result.assets);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取项目资料失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const upsertInput = (item: ProjectInput) => setInputs((current) => [item, ...current.filter((value) => value.id !== item.id)]);
  const upsertReference = (item: ProjectReference) => setReferences((current) => [item, ...current.filter((value) => value.id !== item.id)]);
  const upsertAsset = (item: ProjectAsset) => setAssets((current) => [item, ...current.filter((value) => value.id !== item.id)]);
  const removeInput = async (item: ProjectInput) => {
    if (!window.confirm(`删除“${item.title}”？`)) return;
    try { await webCreative.removeInput(item.id); setInputs((current) => current.filter((value) => value.id !== item.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败。'); }
  };
  const removeReference = async (item: ProjectReference) => {
    if (!window.confirm(`删除“${item.title}”？`)) return;
    try { await webCreative.removeReference(item.id); setReferences((current) => current.filter((value) => value.id !== item.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败。'); }
  };
  const removeAsset = async (item: ProjectAsset) => {
    if (!window.confirm(`解除“${item.title}”在当前项目中的引用？`)) return;
    try { await webAssets.unlink(projectId, item.id); setAssets((current) => current.filter((value) => value.id !== item.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : '解除素材引用失败。'); }
  };
  const openLink = (item: ProjectReference) => { if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer'); };
  return <section className="project-material-workspace"><section className="project-materials">
    <header className="materials-head"><div><h2>资料与研究</h2><div className="materials-counts"><span>{inputs.length} 条内容</span><span>{links.length} 条参考</span><span>{assets.length} 个素材</span></div></div><div className="materials-head-actions">{tab === 'ASSETS' && <button className="button" type="button" onClick={() => setPickerOpen(true)}><Image size={16}/>从素材库选择</button>}<button className="button primary" type="button" onClick={() => setEditor(tab === 'INPUTS' ? { type: 'INPUT' } : tab === 'LINKS' ? { type: 'LINK' } : { type: 'ASSET' })}>{tab === 'ASSETS' ? <Upload size={16}/> : <Plus size={16}/>} {tab === 'INPUTS' ? '新增内容' : tab === 'LINKS' ? '新增参考' : '上传新素材'}</button></div></header>
    <nav className="materials-tabs" aria-label="项目资料分类"><button type="button" className={tab === 'INPUTS' ? 'active' : ''} onClick={() => setTab('INPUTS')}>我的内容 <span>{inputs.length}</span></button><button type="button" className={tab === 'LINKS' ? 'active' : ''} onClick={() => setTab('LINKS')}>参考链接 <span>{links.length}</span></button><button type="button" className={tab === 'ASSETS' ? 'active' : ''} onClick={() => setTab('ASSETS')}>项目素材 <span>{assets.length}</span></button></nav>
    {error && <div className="materials-error" role="alert">{error}</div>}
    {loading ? <div className="materials-loading"><LoaderCircle size={19}/><span>读取项目资料</span></div> : <div className="materials-list">
      {tab === 'INPUTS' && (inputs.length ? inputs.map((item) => <article className="material-row input-row" key={item.id}><div className="material-row-main"><div className="material-row-title"><span className={`material-role role-${item.kind.toLowerCase()}`}>{inputKindName[item.kind]}</span><h3>{item.title}</h3></div><p>{item.body}</p><small>{scopeText(item.scope, item.platforms)}</small></div><div className="material-row-actions"><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} onClick={() => setEditor({ type: 'INPUT', item })}><Pencil size={16}/></button><button className="icon-button danger-icon" type="button" title="删除" aria-label={`删除 ${item.title}`} onClick={() => void removeInput(item)}><Trash2 size={16}/></button></div></article>) : <div className="materials-empty">还没有项目内容</div>)}
      {tab === 'LINKS' && (links.length ? links.map((item) => <article className="material-row" key={item.id}><div className="material-source-icon"><Link2 size={18}/></div><div className="material-row-main"><div className="material-row-title"><span className={`material-role role-${item.role.toLowerCase()}`}>{referenceRoleName[item.role]}</span><h3>{item.title}</h3></div><p>{item.notes || item.url}</p><small>{scopeText(item.scope, item.platforms)} · 未读取</small></div><div className="material-row-actions"><button className="icon-button" type="button" title="打开" aria-label={`打开 ${item.title}`} onClick={() => openLink(item)}><ExternalLink size={16}/></button><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} onClick={() => setEditor({ type: 'LINK', item })}><Pencil size={16}/></button><button className="icon-button danger-icon" type="button" title="删除" aria-label={`删除 ${item.title}`} onClick={() => void removeReference(item)}><Trash2 size={16}/></button></div></article>) : <div className="materials-empty">还没有参考链接</div>)}
      {tab === 'ASSETS' && (assets.length ? assets.map((item) => <article className="material-row" key={item.id}><div className="material-source-icon">{fileIcon(item.mimeType)}</div><div className="material-row-main"><div className="material-row-title"><span className="material-role role-visual">素材</span><h3>{item.title}</h3></div><p>{item.originalFilename} · {formatBytes(item.sizeBytes)}</p><small>{scopeText(item.scope, item.platforms)} · {item.origin}</small></div><div className="material-row-actions"><button className="icon-button" type="button" title="预览" aria-label={`预览 ${item.title}`} onClick={() => setPreviewAsset(item)}><Image size={16}/></button><button className="icon-button danger-icon" type="button" title="解除引用" aria-label={`解除引用 ${item.title}`} onClick={() => void removeAsset(item)}><Trash2 size={16}/></button></div></article>) : <div className="materials-empty">还没有项目素材</div>)}
    </div>}
    {editor && <MaterialDialog editor={editor} projectId={projectId} availablePlatforms={platforms} busy={busy} onBusy={setBusy} onClose={() => !busy && setEditor(null)} onError={setError} onInput={upsertInput} onReference={upsertReference} onAsset={upsertAsset}/>}
    {previewAsset && <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)}/>} 
    {pickerOpen && <AssetPickerDialog projectId={projectId} role="VISUAL" scope="PROJECT" platforms={[]} excludedAssetIds={assets.map((asset) => asset.id)} onLinked={upsertAsset} onClose={() => setPickerOpen(false)}/>} 
  </section></section>;
}

function MaterialDialog({ editor, projectId, availablePlatforms, busy, onBusy, onClose, onError, onInput, onReference, onAsset }: { editor: Editor; projectId: string; availablePlatforms: CreativePlatform[]; busy: boolean; onBusy: (value: boolean) => void; onClose: () => void; onError: (value: string) => void; onInput: (item: ProjectInput) => void; onReference: (item: ProjectReference) => void; onAsset: (item: ProjectAsset) => void }) {
  const inputItem = editor.type === 'INPUT' ? editor.item : undefined;
  const referenceItem = editor.type === 'LINK' ? editor.item : undefined;
  const [kind, setKind] = useState<ProjectInputKind>(inputItem?.kind ?? 'IDEA');
  const [role, setRole] = useState<ProjectReferenceRole>(referenceItem?.role ?? 'FACT');
  const [title, setTitle] = useState(inputItem?.title ?? referenceItem?.title ?? '');
  const [body, setBody] = useState(inputItem?.body ?? '');
  const [notes, setNotes] = useState(referenceItem?.notes ?? '');
  const [url, setUrl] = useState(referenceItem?.url ?? '');
  const [scope, setScope] = useState<ProjectMaterialScope>(inputItem?.scope ?? referenceItem?.scope ?? 'PROJECT');
  const [selectedPlatforms, setSelectedPlatforms] = useState<CreativePlatform[]>(inputItem?.platforms ?? referenceItem?.platforms ?? []);
  const [file, setFile] = useState<File | null>(null);
  const isInput = editor.type === 'INPUT'; const isAsset = editor.type === 'ASSET';
  const canSave = isInput ? Boolean(body.trim() && (!inputItem || title.trim())) : isAsset ? Boolean(file) : Boolean(title.trim() && url.trim());
  const togglePlatform = (platform: CreativePlatform) => setSelectedPlatforms((current) => current.includes(platform) ? current.filter((value) => value !== platform) : [...current, platform]);
  const save = async () => {
    if (!canSave) return;
    onBusy(true); onError('');
    try {
      if (isInput) {
        const payload: ProjectInputPayload = { kind, ...(inputItem ? { title } : {}), body, scope, platforms: selectedPlatforms };
        onInput(inputItem ? await webCreative.updateInput(inputItem.id, payload) : await webCreative.createInput(projectId, payload));
      } else if (editor.type === 'LINK') {
        const metadata: ProjectReferenceMetadata = { role, title, notes, scope, platforms: selectedPlatforms };
        onReference(referenceItem ? await webCreative.updateReference(referenceItem.id, metadata) : await webCreative.createReference(projectId, { ...metadata, url }));
      } else if (file) {
        const result = await webAssets.upload(file, { title: title.trim() || file.name });
        const linked = await webAssets.link(projectId, result.asset.id, { role, scope, title: title.trim() || result.asset.title, notes, platforms: selectedPlatforms });
        onAsset(linked);
      }
      onClose();
    } catch (reason) { onError(reason instanceof Error ? reason.message : '保存项目资料失败。'); } finally { onBusy(false); }
  };
  const heading = isInput ? (inputItem ? '编辑资料' : '新增项目内容') : editor.type === 'LINK' ? (referenceItem ? '编辑参考链接' : '新增参考链接') : '上传项目素材';
  return <div className="material-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="material-dialog" role="dialog" aria-modal="true" aria-labelledby="material-dialog-title"><header><h2 id="material-dialog-title">{heading}</h2><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={18}/></button></header><div className="material-dialog-body">
    {isInput ? <label><span>内容类型</span><select value={kind} onChange={(event) => setKind(event.target.value as ProjectInputKind)}>{inputKinds.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : <label><span>参考用途</span><select value={role} onChange={(event) => setRole(event.target.value as ProjectReferenceRole)}>{referenceRoles.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}
    {(!isInput || inputItem) && <label><span>标题</span><input aria-label={isInput ? '项目内容标题' : '参考资料标题'} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)}/></label>}
    {isInput && <label className="wide"><span>正文</span><textarea aria-label="项目内容正文" rows={11} value={body} maxLength={50_000} onChange={(event) => setBody(event.target.value)}/></label>}
    {editor.type === 'LINK' && !referenceItem && <label className="wide"><span>公开链接</span><input aria-label="参考资料链接" type="url" value={url} maxLength={2_000} onChange={(event) => setUrl(event.target.value)}/></label>}
    {isAsset && <label className="wide file-field"><span>选择文件</span><input aria-label="项目素材" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,audio/mpeg,audio/wav,audio/mp4,video/mp4,video/webm" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !title.trim()) setTitle(next.name); }}/></label>}
    {!isInput && <label className="wide"><span>备注</span><textarea aria-label="参考资料备注" rows={4} value={notes} maxLength={4_000} onChange={(event) => setNotes(event.target.value)}/></label>}
    <label><span>使用阶段</span><select value={scope} onChange={(event) => setScope(event.target.value as ProjectMaterialScope)}>{materialScopes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><fieldset><legend>适用平台</legend><div className="material-platform-picker"><button type="button" className={selectedPlatforms.length === 0 ? 'active' : ''} onClick={() => setSelectedPlatforms([])}>全部</button>{availablePlatforms.map((platform) => <button type="button" key={platform} className={selectedPlatforms.includes(platform) ? 'active' : ''} onClick={() => togglePlatform(platform)}>{platformName[platform]}</button>)}</div></fieldset>
  </div><footer><button className="button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button primary" type="button" disabled={busy || !canSave} onClick={() => void save()}>{busy ? <LoaderCircle size={16}/> : null}{busy ? '保存中' : '保存'}</button></footer></section></div>;
}
