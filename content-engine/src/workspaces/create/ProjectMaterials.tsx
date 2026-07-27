import { ExternalLink, FileAudio, FileText, FileVideo, Image, Link2, LoaderCircle, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName } from '../../domain/content';
import type { CreativePlatform, ProjectInput, ProjectInputKind, ProjectInputPayload, ProjectMaterialScope, ProjectReference, ProjectReferenceMetadata, ProjectReferenceRole, ProjectResearchContext } from '../../domain/creative';
import { ProjectResearchAgent } from './ProjectResearchAgent';

type MaterialTab = 'INPUTS' | 'LINKS' | 'FILES';
type Editor = { type: 'INPUT'; item?: ProjectInput } | { type: 'REFERENCE'; sourceType: 'LINK' | 'FILE'; item?: ProjectReference };

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

function formatBytes(value: number | null) {
  if (value === null) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return <Image size={18}/>;
  if (mimeType?.startsWith('audio/')) return <FileAudio size={18}/>;
  if (mimeType?.startsWith('video/')) return <FileVideo size={18}/>;
  return <FileText size={18}/>;
}

function scopeText(scope: ProjectMaterialScope, platforms: CreativePlatform[]) {
  return `${scopeName[scope]} · ${platforms.length ? platforms.map((platform) => platformName[platform]).join('、') : '全部平台'}`;
}

export function ProjectMaterials({ projectId, platforms, overviewReady, hasDraft, onOpenAgentSettings }: { projectId: string; platforms: CreativePlatform[]; overviewReady: boolean; hasDraft: boolean; onOpenAgentSettings: () => void }) {
  const [inputs, setInputs] = useState<ProjectInput[]>([]);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [tab, setTab] = useState<MaterialTab>('INPUTS');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [research, setResearch] = useState<ProjectResearchContext | null>(null);
  const [selectedInputIds, setSelectedInputIds] = useState<string[]>([]);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);

  const links = useMemo(() => references.filter((item) => item.sourceType === 'LINK'), [references]);
  const files = useMemo(() => references.filter((item) => item.sourceType === 'FILE'), [references]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([webCreative.materials(projectId), webCreative.research(projectId)]).then(([result, researchResult]) => {
      if (cancelled) return;
      setInputs(result.inputs); setReferences(result.references);
      setResearch(researchResult);
      setSelectedInputIds(researchResult.run?.materialIds.inputIds.length ? researchResult.run.materialIds.inputIds : result.inputs.filter((item) => item.scope === 'PROJECT' || item.scope === 'RESEARCH').map((item) => item.id));
      setSelectedReferenceIds(researchResult.run?.materialIds.referenceIds.length ? researchResult.run.materialIds.referenceIds : result.references.filter((item) => item.scope === 'PROJECT' || item.scope === 'RESEARCH').map((item) => item.id));
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取项目资料失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const upsertInput = (item: ProjectInput) => { setInputs((current) => [item, ...current.filter((value) => value.id !== item.id)]); setSelectedInputIds((current) => current.includes(item.id) ? current : [...current, item.id]); };
  const upsertReference = (item: ProjectReference) => { setReferences((current) => [item, ...current.filter((value) => value.id !== item.id)]); setSelectedReferenceIds((current) => current.includes(item.id) ? current : [...current, item.id]); };

  const removeInput = async (item: ProjectInput) => {
    if (!window.confirm(`删除“${item.title}”？`)) return;
    setError('');
    try { await webCreative.removeInput(item.id); setInputs((current) => current.filter((value) => value.id !== item.id)); setSelectedInputIds((current) => current.filter((id) => id !== item.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败。'); }
  };

  const removeReference = async (item: ProjectReference) => {
    if (!window.confirm(`删除“${item.title}”？`)) return;
    setError('');
    try { await webCreative.removeReference(item.id); setReferences((current) => current.filter((value) => value.id !== item.id)); setSelectedReferenceIds((current) => current.filter((id) => id !== item.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败。'); }
  };

  const openReference = async (item: ProjectReference) => {
    setError('');
    try {
      if (item.url) { window.open(item.url, '_blank', 'noopener,noreferrer'); return; }
      const blob = await webCreative.projectFile(item.id);
      const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '打开素材失败。'); }
  };

  const usedInputs = new Set(research?.usedMaterialIds.inputIds ?? []);
  const usedReferences = new Set(research?.usedMaterialIds.referenceIds ?? []);
  const materialCount = inputs.length + references.length;
  const progress = [
    { label: '项目概览', done: overviewReady },
    { label: '项目资料', done: materialCount > 0 },
    { label: '研究计划', done: Boolean(research?.plan) },
    { label: '正式文案', done: hasDraft },
  ];
  const completed = progress.filter((item) => item.done).length;
  const currentProgressIndex = progress.findIndex((item) => !item.done);
  const toggleInput = (id: string) => setSelectedInputIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleReference = (id: string) => setSelectedReferenceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const allSelected = selectedInputIds.length === inputs.length && selectedReferenceIds.length === references.length && materialCount > 0;

  return <section className="project-material-workspace">
    <div className="project-progress-band"><div><span>项目进度</span><b>{completed}/{progress.length}</b></div><ol>{progress.map((item, index) => <li key={item.label} className={item.done ? 'done' : index === currentProgressIndex ? 'current' : ''}><i>{item.done ? '✓' : index + 1}</i><span>{item.label}</span></li>)}</ol></div>
    <div className="project-research-layout"><section className="project-materials">
    <header className="materials-head">
      <div><h2>资料与研究</h2><div className="materials-counts"><span>{inputs.length} 条内容</span><span>{links.length} 条参考</span><span>{files.length} 个文件</span></div></div>
      <button className="button primary" type="button" onClick={() => setEditor(tab === 'INPUTS' ? { type: 'INPUT' } : { type: 'REFERENCE', sourceType: tab === 'LINKS' ? 'LINK' : 'FILE' })}>{tab === 'FILES' ? <Upload size={16}/> : <Plus size={16}/>} {tab === 'INPUTS' ? '新增内容' : tab === 'LINKS' ? '新增参考' : '上传素材'}</button>
    </header>
    <nav className="materials-tabs" aria-label="项目资料分类">
      <button type="button" className={tab === 'INPUTS' ? 'active' : ''} onClick={() => setTab('INPUTS')}>我的内容 <span>{inputs.length}</span></button>
      <button type="button" className={tab === 'LINKS' ? 'active' : ''} onClick={() => setTab('LINKS')}>参考链接 <span>{links.length}</span></button>
      <button type="button" className={tab === 'FILES' ? 'active' : ''} onClick={() => setTab('FILES')}>素材文件 <span>{files.length}</span></button>
    </nav>
    <div className="material-selection-bar"><span>已选 {selectedInputIds.length + selectedReferenceIds.length} 条给 Agent</span><button className="text-button" type="button" disabled={materialCount === 0} onClick={() => { setSelectedInputIds(allSelected ? [] : inputs.map((item) => item.id)); setSelectedReferenceIds(allSelected ? [] : references.map((item) => item.id)); }}>{allSelected ? '清空' : '全选'}</button></div>
    {error && <div className="materials-error" role="alert">{error}</div>}
    {loading ? <div className="materials-loading"><LoaderCircle size={19}/><span>读取项目资料</span></div> : <div className="materials-list">
      {tab === 'INPUTS' && (inputs.length ? inputs.map((item) => <article className={`material-row input-row ${selectedInputIds.includes(item.id) ? 'selected' : ''}`} key={item.id}>
        <label className="material-selector"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selectedInputIds.includes(item.id)} onChange={() => toggleInput(item.id)}/><span/></label>
        <div className="material-row-main"><div className="material-row-title"><span className={`material-role role-${item.kind.toLowerCase()}`}>{inputKindName[item.kind]}</span><h3>{item.title}</h3></div><p>{item.body}</p><small>{scopeText(item.scope, item.platforms)}</small></div>
        <div className="material-row-actions">{usedInputs.has(item.id) && <span className="material-used">研究已引用</span>}<button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} onClick={() => setEditor({ type: 'INPUT', item })}><Pencil size={16}/></button><button className="icon-button danger-icon" type="button" title="删除" aria-label={`删除 ${item.title}`} onClick={() => void removeInput(item)}><Trash2 size={16}/></button></div>
      </article>) : <div className="materials-empty">还没有项目内容</div>)}
      {tab === 'LINKS' && (links.length ? links.map((item) => <ReferenceRow key={item.id} item={item} selected={selectedReferenceIds.includes(item.id)} used={usedReferences.has(item.id)} onSelect={() => toggleReference(item.id)} onOpen={() => void openReference(item)} onEdit={() => setEditor({ type: 'REFERENCE', sourceType: 'LINK', item })} onRemove={() => void removeReference(item)}/>) : <div className="materials-empty">还没有参考链接</div>)}
      {tab === 'FILES' && (files.length ? files.map((item) => <ReferenceRow key={item.id} item={item} selected={selectedReferenceIds.includes(item.id)} used={usedReferences.has(item.id)} onSelect={() => toggleReference(item.id)} onOpen={() => void openReference(item)} onEdit={() => setEditor({ type: 'REFERENCE', sourceType: 'FILE', item })} onRemove={() => void removeReference(item)}/>) : <div className="materials-empty">还没有素材文件</div>)}
    </div>}
    {editor && <MaterialDialog
      editor={editor}
      projectId={projectId}
      availablePlatforms={platforms}
      busy={busy}
      onBusy={setBusy}
      onClose={() => !busy && setEditor(null)}
      onError={setError}
      onInput={upsertInput}
      onReference={upsertReference}
    />}
    </section><ProjectResearchAgent projectId={projectId} context={research} selectedInputIds={selectedInputIds} selectedReferenceIds={selectedReferenceIds} onContext={setResearch} onOpenSettings={onOpenAgentSettings}/></div>
  </section>;
}

function ReferenceRow({ item, selected, used, onSelect, onOpen, onEdit, onRemove }: { item: ProjectReference; selected: boolean; used: boolean; onSelect: () => void; onOpen: () => void; onEdit: () => void; onRemove: () => void }) {
  return <article className={`material-row ${selected ? 'selected' : ''}`}>
    <label className="material-selector"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected} onChange={onSelect}/><span/></label>
    <div className="material-source-icon">{item.sourceType === 'LINK' ? <Link2 size={18}/> : fileIcon(item.mimeType)}</div>
    <div className="material-row-main"><div className="material-row-title"><span className={`material-role role-${item.role.toLowerCase()}`}>{referenceRoleName[item.role]}</span><h3>{item.title}</h3></div><p>{item.notes || (item.sourceType === 'LINK' ? item.url : `${item.originalFilename} · ${formatBytes(item.sizeBytes)}`)}</p><small>{scopeText(item.scope, item.platforms)} · {item.sourceType === 'LINK' ? '未读取' : ['text/plain', 'text/markdown'].includes(item.mimeType ?? '') ? '文本可读取' : '仅文件信息'}</small></div>
    <div className="material-row-actions">{used && <span className="material-used">研究已引用</span>}<button className="icon-button" type="button" title="打开" aria-label={`打开 ${item.title}`} onClick={onOpen}><ExternalLink size={16}/></button><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} onClick={onEdit}><Pencil size={16}/></button><button className="icon-button danger-icon" type="button" title="删除" aria-label={`删除 ${item.title}`} onClick={onRemove}><Trash2 size={16}/></button></div>
  </article>;
}

function MaterialDialog({ editor, projectId, availablePlatforms, busy, onBusy, onClose, onError, onInput, onReference }: {
  editor: Editor; projectId: string; availablePlatforms: CreativePlatform[]; busy: boolean; onBusy: (value: boolean) => void; onClose: () => void; onError: (value: string) => void; onInput: (item: ProjectInput) => void; onReference: (item: ProjectReference) => void;
}) {
  const inputItem = editor.type === 'INPUT' ? editor.item : undefined;
  const referenceItem = editor.type === 'REFERENCE' ? editor.item : undefined;
  const [kind, setKind] = useState<ProjectInputKind>(inputItem?.kind ?? 'IDEA');
  const [role, setRole] = useState<ProjectReferenceRole>(referenceItem?.role ?? (editor.type === 'REFERENCE' && editor.sourceType === 'FILE' ? 'VISUAL' : 'FACT'));
  const [title, setTitle] = useState(inputItem?.title ?? referenceItem?.title ?? '');
  const [body, setBody] = useState(inputItem?.body ?? '');
  const [notes, setNotes] = useState(referenceItem?.notes ?? '');
  const [url, setUrl] = useState(referenceItem?.url ?? '');
  const [scope, setScope] = useState<ProjectMaterialScope>(inputItem?.scope ?? referenceItem?.scope ?? 'PROJECT');
  const [selectedPlatforms, setSelectedPlatforms] = useState<CreativePlatform[]>(inputItem?.platforms ?? referenceItem?.platforms ?? []);
  const [file, setFile] = useState<File | null>(null);

  const togglePlatform = (platform: CreativePlatform) => setSelectedPlatforms((current) => current.includes(platform) ? current.filter((value) => value !== platform) : [...current, platform]);
  const isInput = editor.type === 'INPUT';
  const isNewFile = editor.type === 'REFERENCE' && editor.sourceType === 'FILE' && !referenceItem;
  const canSave = title.trim() && (isInput ? body.trim() : editor.type === 'REFERENCE' && editor.sourceType === 'LINK' && !referenceItem ? url.trim() : !isNewFile || file);

  const save = async () => {
    if (!canSave) return;
    onBusy(true); onError('');
    try {
      if (editor.type === 'INPUT') {
        const payload: ProjectInputPayload = { kind, title, body, scope, platforms: selectedPlatforms };
        onInput(editor.item ? await webCreative.updateInput(editor.item.id, payload) : await webCreative.createInput(projectId, payload));
      } else {
        const metadata: ProjectReferenceMetadata = { role, title, notes, scope, platforms: selectedPlatforms };
        if (editor.item) onReference(await webCreative.updateReference(editor.item.id, metadata));
        else if (editor.sourceType === 'LINK') onReference(await webCreative.createReference(projectId, { ...metadata, url }));
        else if (file) onReference(await webCreative.uploadFile(projectId, file, metadata));
      }
      onClose();
    } catch (reason) { onError(reason instanceof Error ? reason.message : '保存项目资料失败。'); }
    finally { onBusy(false); }
  };

  const heading = editor.item ? '编辑资料' : isInput ? '新增项目内容' : editor.sourceType === 'LINK' ? '新增参考链接' : '上传素材文件';
  return <div className="material-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="material-dialog" role="dialog" aria-modal="true" aria-labelledby="material-dialog-title">
      <header><h2 id="material-dialog-title">{heading}</h2><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={18}/></button></header>
      <div className="material-dialog-body">
        {isInput ? <label><span>内容类型</span><select value={kind} onChange={(event) => setKind(event.target.value as ProjectInputKind)}>{inputKinds.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : <label><span>参考用途</span><select value={role} onChange={(event) => setRole(event.target.value as ProjectReferenceRole)}>{referenceRoles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <label><span>标题</span><input aria-label={isInput ? '项目内容标题' : '参考资料标题'} value={title} maxLength={editor.type === 'INPUT' ? 160 : 200} onChange={(event) => setTitle(event.target.value)}/></label>
        {isInput && <label className="wide"><span>正文</span><textarea aria-label="项目内容正文" rows={11} value={body} maxLength={50_000} onChange={(event) => setBody(event.target.value)}/></label>}
        {!isInput && editor.sourceType === 'LINK' && !referenceItem && <label className="wide"><span>公开链接</span><input aria-label="参考资料链接" type="url" value={url} maxLength={2_000} onChange={(event) => setUrl(event.target.value)}/></label>}
        {isNewFile && <label className="wide file-field"><span>选择文件</span><input aria-label="素材文件" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,audio/mpeg,audio/wav,audio/mp4,video/mp4,video/webm" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !title.trim()) setTitle(next.name); }}/></label>}
        {!isInput && <label className="wide"><span>备注</span><textarea aria-label="参考资料备注" rows={4} value={notes} maxLength={4_000} onChange={(event) => setNotes(event.target.value)}/></label>}
        <label><span>使用阶段</span><select value={scope} onChange={(event) => setScope(event.target.value as ProjectMaterialScope)}>{materialScopes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <fieldset><legend>适用平台</legend><div className="material-platform-picker"><button type="button" className={selectedPlatforms.length === 0 ? 'active' : ''} onClick={() => setSelectedPlatforms([])}>全部</button>{availablePlatforms.map((platform) => <button type="button" key={platform} className={selectedPlatforms.includes(platform) ? 'active' : ''} onClick={() => togglePlatform(platform)}>{platformName[platform]}</button>)}</div></fieldset>
      </div>
      <footer><button className="button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button primary" type="button" disabled={busy || !canSave} onClick={() => void save()}>{busy ? <LoaderCircle size={16}/> : null}{busy ? '保存中' : '保存'}</button></footer>
    </section>
  </div>;
}
