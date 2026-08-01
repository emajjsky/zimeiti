import { Check, File, Image, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webAssets } from '../../data/webApi';
import type { ProjectAsset, WorkspaceAsset } from '../../domain/assets';
import type { CreativePlatform, ProjectMaterialScope, ProjectReferenceRole } from '../../domain/creative';
import { AssetPreviewDialog } from './AssetPreviewDialog';

export function AssetPickerDialog({ projectId, role, scope, platforms, excludedAssetIds = [], imageOnly = false, onLinked, onClose }: {
  projectId: string;
  role: ProjectReferenceRole;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  excludedAssetIds?: string[];
  imageOnly?: boolean;
  onLinked: (asset: ProjectAsset) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [linkingId, setLinkingId] = useState('');
  const [preview, setPreview] = useState<WorkspaceAsset | null>(null);
  const [error, setError] = useState('');
  const excluded = useMemo(() => new Set(excludedAssetIds), [excludedAssetIds]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void webAssets.list({ status: 'ACTIVE' }).then(({ assets: listed }) => {
      if (active) setAssets(listed.filter((asset) => !excluded.has(asset.id) && (!imageOnly || asset.kind === 'IMAGE')));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '读取素材库失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [excluded, imageOnly]);

  const visible = assets.filter((asset) => `${asset.title} ${asset.originalFilename} ${asset.sourceNote}`.toLowerCase().includes(query.trim().toLowerCase()));
  const link = async (asset: WorkspaceAsset) => {
    setLinkingId(asset.id); setError('');
    try {
      const linked = await webAssets.link(projectId, asset.id, { role, scope, platforms, notes: '' });
      onLinked(linked);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '关联素材失败。'); }
    finally { setLinkingId(''); }
  };

  return <><div className="asset-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="asset-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
      <header><div><h2 id="asset-picker-title">从素材库选择</h2><span>同一份文件可供多个项目复用</span></div><button className="icon-button" type="button" aria-label="关闭素材选择" onClick={onClose}><X size={18}/></button></header>
      <div className="asset-picker-toolbar"><Search size={16}/><input aria-label="搜索空间素材" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、文件名或来源"/></div>
      {error && <div className="asset-inline-error" role="alert">{error}</div>}
      <div className="asset-picker-grid">{loading ? <div className="asset-preview-state"><LoaderCircle size={24}/><span>读取素材库</span></div> : visible.length ? visible.map((asset) => <article className="asset-picker-item" key={asset.id}>
        <button className="asset-picker-preview" type="button" onClick={() => setPreview(asset)}>{asset.kind === 'IMAGE' ? <Image size={24}/> : <File size={24}/>}<span>预览</span></button>
        <div><b>{asset.title}</b><small>{asset.originalFilename}</small><span>{asset.projectCount} 个项目使用</span></div>
        <button className="button" type="button" disabled={Boolean(linkingId)} onClick={() => void link(asset)}>{linkingId === asset.id ? <LoaderCircle size={14}/> : <Check size={14}/>}选择</button>
      </article>) : <div className="asset-preview-state"><File size={26}/><span>没有可选择的素材</span></div>}</div>
    </section>
  </div>{preview && <AssetPreviewDialog asset={preview} onClose={() => setPreview(null)}/>}</>;
}
