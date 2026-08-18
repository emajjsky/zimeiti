import { Archive, File, Image, LoaderCircle, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetPreviewDialog } from '../../components/assets/AssetPreviewDialog';
import { PageHeader } from '../../components/workspace/PageHeader';
import { webAssets } from '../../data/webApi';
import type { AssetCopyrightStatus, AssetKind, AssetOrigin, AssetStatus, WorkspaceAsset } from '../../domain/assets';

const kindNames: Record<AssetKind, string> = { IMAGE: '图片', DOCUMENT: '文档', AUDIO: '音频', VIDEO: '视频', OTHER: '其他' };
const originNames: Record<AssetOrigin, string> = { UPLOAD: '本地上传', AI_GENERATED: 'AI 生成', WEB_IMPORT: '网络导入' };
const copyrightNames: Record<AssetCopyrightStatus, string> = { PENDING: '待确认', OWNED: '自有版权', LICENSED: '已获授权', OPEN_LICENSE: '开放许可', PROHIBITED: '禁止使用' };

function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }

export function AssetLibrary() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | ''>('');
  const [origin, setOrigin] = useState<AssetOrigin | ''>('');
  const [copyright, setCopyright] = useState<AssetCopyrightStatus | ''>('');
  const [status, setStatus] = useState<Exclude<AssetStatus, 'DELETING'>>('ACTIVE');
  const [fromDate, setFromDate] = useState('');
  const [preview, setPreview] = useState<WorkspaceAsset | null>(null);
  const [editing, setEditing] = useState<WorkspaceAsset | null>(null);

  const load = () => {
    setLoading(true); setError('');
    void webAssets.list({ status, ...(kind ? { kind } : {}), ...(origin ? { origin } : {}), ...(query.trim() ? { query } : {}) })
      .then(({ assets: listed }) => setAssets(listed))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '读取素材库失败。'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [kind, origin, query, status]);

  const visible = useMemo(() => assets.filter((asset) => (!copyright || asset.copyrightStatus === copyright) && (!fromDate || new Date(asset.createdAt) >= new Date(`${fromDate}T00:00:00`))), [assets, copyright, fromDate]);
  const upload = async (file: File) => {
    setBusy(true); setError('');
    try { const result = await webAssets.upload(file, { title: file.name }); setAssets((current) => [result.asset, ...current.filter((asset) => asset.id !== result.asset.id)]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '上传素材失败。'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const remove = async (asset: WorkspaceAsset) => {
    if (asset.projectCount > 0 || !window.confirm(`永久删除“${asset.title}”？`)) return;
    setError('');
    try { await webAssets.remove(asset.id); setAssets((current) => current.filter((item) => item.id !== asset.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '提交素材删除失败。'); }
  };

  return <section className="asset-library"><PageHeader eyebrow="ASSET LIBRARY / 素材库" title="空间素材库" subtitle="素材归属于当前工作空间，可被多个内容项目复用。" actions={<><input ref={inputRef} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}/><button className="button primary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? <LoaderCircle size={16}/> : <Upload size={16}/>}上传素材</button></>}/>
    <div className="asset-library-toolbar"><label className="asset-search"><Search size={16}/><input aria-label="搜索素材" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、文件名或来源"/></label><select aria-label="素材类型" value={kind} onChange={(event) => setKind(event.target.value as AssetKind | '')}><option value="">全部类型</option>{Object.entries(kindNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><select aria-label="素材来源" value={origin} onChange={(event) => setOrigin(event.target.value as AssetOrigin | '')}><option value="">全部来源</option>{Object.entries(originNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><select aria-label="版权状态" value={copyright} onChange={(event) => setCopyright(event.target.value as AssetCopyrightStatus | '')}><option value="">全部版权</option>{Object.entries(copyrightNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><select aria-label="归档状态" value={status} onChange={(event) => setStatus(event.target.value as Exclude<AssetStatus, 'DELETING'>)}><option value="ACTIVE">使用中</option><option value="ARCHIVED">已归档</option></select><input aria-label="起始日期" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)}/></div>
    {error && <div className="asset-inline-error" role="alert">{error}</div>}
    <div className="asset-library-summary"><b>{visible.length}</b><span>份素材</span><i/><span>{visible.reduce((sum, asset) => sum + asset.projectCount, 0)} 次项目引用</span></div>
    {loading ? <div className="asset-preview-state"><LoaderCircle size={26}/><span>正在读取素材库</span></div> : visible.length ? <div className="asset-library-grid">{visible.map((asset) => <article className="asset-card" key={asset.id}>
      <AssetThumbnail asset={asset} onOpen={() => setPreview(asset)} />
      <div className="asset-card-body"><div><b>{asset.title}</b><span className="asset-card-actions"><button className="icon-button" type="button" aria-label={`编辑 ${asset.title}`} onClick={() => setEditing(asset)}><Pencil size={15}/></button><button className="icon-button danger-icon" type="button" aria-label={`删除 ${asset.title}`} title={asset.projectCount ? '请先解除项目引用' : '永久删除'} disabled={asset.projectCount > 0} onClick={() => void remove(asset)}><Trash2 size={15}/></button></span></div><small>{asset.originalFilename} · {formatBytes(asset.sizeBytes)}</small><p>{asset.sourceNote || originNames[asset.origin]}</p><footer><span>{copyrightNames[asset.copyrightStatus]}</span><b>{asset.projectCount} 个项目</b></footer></div>
    </article>)}</div> : <div className="asset-library-empty"><Archive size={32}/><b>当前筛选下没有素材</b><span>上传文件后即可在项目资料和配图中复用。</span></div>}
    {preview && <AssetPreviewDialog asset={preview} onClose={() => setPreview(null)}/>} {editing && <AssetEditDialog asset={editing} onClose={() => setEditing(null)} onSaved={(asset) => { setAssets((current) => current.map((item) => item.id === asset.id ? asset : item)); setEditing(null); }}/>} 
  </section>;
}

function AssetThumbnail({ asset, onOpen }: { asset: WorkspaceAsset; onOpen: () => void }) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (asset.kind !== 'IMAGE' || !hostRef.current) return undefined;
    let active = true;
    let objectUrl = '';
    const load = () => {
      void webAssets.content(asset.id).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }).catch(() => { if (active) setFailed(true); });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: '240px' });
    observer.observe(hostRef.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id, asset.kind]);

  return <button ref={hostRef} className="asset-card-preview" type="button" aria-label={`预览 ${asset.title}`} onClick={onOpen}>
    {src ? <img src={src} alt="" loading="lazy"/> : asset.kind === 'IMAGE' ? <><Image size={28}/><span>{failed ? '预览失败' : '加载预览'}</span></> : <><File size={28}/><span>{kindNames[asset.kind]}</span></>}
  </button>;
}

function AssetEditDialog({ asset, onClose, onSaved }: { asset: WorkspaceAsset; onClose: () => void; onSaved: (asset: WorkspaceAsset) => void }) {
  const [title, setTitle] = useState(asset.title); const [sourceNote, setSourceNote] = useState(asset.sourceNote); const [copyrightStatus, setCopyrightStatus] = useState(asset.copyrightStatus); const [status, setStatus] = useState<Exclude<AssetStatus, 'DELETING'>>(asset.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { onSaved(await webAssets.update(asset.id, { title: title.trim(), sourceNote: sourceNote.trim(), copyrightStatus, status })); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存素材失败。'); } finally { setBusy(false); } };
  return <div className="asset-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="asset-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-edit-title"><header><h2 id="asset-edit-title">编辑素材</h2><button className="icon-button" type="button" aria-label="关闭素材编辑" onClick={onClose}><X size={18}/></button></header><div><label><span>标题</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)}/></label><label><span>来源说明</span><textarea value={sourceNote} maxLength={2000} onChange={(event) => setSourceNote(event.target.value)}/></label><label><span>版权状态</span><select value={copyrightStatus} onChange={(event) => setCopyrightStatus(event.target.value as AssetCopyrightStatus)}>{Object.entries(copyrightNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label><span>归档状态</span><select value={status} onChange={(event) => setStatus(event.target.value as Exclude<AssetStatus, 'DELETING'>)}><option value="ACTIVE">使用中</option><option value="ARCHIVED">已归档</option></select></label>{error && <div className="asset-inline-error" role="alert">{error}</div>}</div><footer><button className="button" type="button" onClick={onClose}>取消</button><button className="button primary" type="button" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? <LoaderCircle size={15}/> : null}保存</button></footer></section></div>;
}
