import { File, Image, LoaderCircle, Search, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webAssets } from '../../data/webApi';
import type { ProjectAsset, WorkspaceAsset } from '../../domain/assets';
import type { CreativePlatform, ProjectMaterialScope, ProjectReferenceRole } from '../../domain/creative';

const EMPTY_EXCLUDED_ASSET_IDS: string[] = [];

type AssetPickerDialogProps = {
  projectId: string;
  role: ProjectReferenceRole;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  excludedAssetIds?: string[];
  imageOnly?: boolean;
  allowUpload?: boolean;
  onLinked: (asset: ProjectAsset) => void;
  onClose: () => void;
};

export function AssetPickerDialog({
  projectId,
  role,
  scope,
  platforms,
  excludedAssetIds = EMPTY_EXCLUDED_ASSET_IDS,
  imageOnly = false,
  allowUpload = false,
  onLinked,
  onClose,
}: AssetPickerDialogProps) {
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [linkingId, setLinkingId] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const excluded = useMemo(() => new Set(excludedAssetIds), [excludedAssetIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void webAssets.list({ status: 'ACTIVE' })
      .then(({ assets: listed }) => {
        if (active) setAssets(listed.filter((asset) => !excluded.has(asset.id) && (!imageOnly || asset.kind === 'IMAGE')));
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取素材库失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [excluded, imageOnly]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setPreviewUrls({});
    void Promise.allSettled(assets.filter((asset) => asset.kind === 'IMAGE').map(async (asset) => {
      const url = URL.createObjectURL(await webAssets.content(asset.id));
      if (!active) {
        URL.revokeObjectURL(url);
        return null;
      }
      urls.push(url);
      return [asset.id, url] as const;
    })).then((results) => {
      if (!active) return;
      const entries = results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
      setPreviewUrls(Object.fromEntries(entries));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => `${asset.title} ${asset.originalFilename} ${asset.sourceNote}`.toLowerCase().includes(keyword));
  }, [assets, query]);

  const columns = useMemo(() => {
    const result: WorkspaceAsset[][] = [[], [], []];
    visible.forEach((asset, index) => result[index % result.length].push(asset));
    return result;
  }, [visible]);

  const link = async (asset: WorkspaceAsset) => {
    setLinkingId(asset.id);
    setError('');
    try {
      const linked = await webAssets.link(projectId, asset.id, { role, scope, platforms, notes: '' });
      onLinked(linked);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关联素材失败');
    } finally {
      setLinkingId('');
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await webAssets.upload(file, { title: file.name });
      const linked = await webAssets.link(projectId, result.asset.id, { role, scope, platforms, notes: '' });
      onLinked(linked);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传参考图失败');
    } finally {
      setUploading(false);
    }
  };

  return <div className="asset-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="asset-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
      <header><div><h2 id="asset-picker-title">从素材库选择</h2></div><button className="icon-button" type="button" aria-label="关闭素材选择" onClick={onClose}><X size={18} /></button></header>
      <div className="asset-picker-toolbar"><Search size={16} /><input aria-label="搜索空间素材" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图片" /></div>
      {allowUpload && <div className="asset-picker-upload-action"><input ref={inputRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} /><button className="button primary" type="button" disabled={uploading || Boolean(linkingId)} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle size={14} /> : <Upload size={14} />}上传图片</button></div>}
      {error && <div className="asset-inline-error" role="alert">{error}</div>}
      <div className="asset-picker-grid">
        {loading ? <div className="asset-preview-state"><LoaderCircle size={24} /><span>读取素材库</span></div> : visible.length ? <div className="asset-picker-waterfall">
          {columns.map((column, columnIndex) => <div className="asset-picker-waterfall-column" key={columnIndex}>{column.map((asset) => <button className="asset-picker-waterfall-image" type="button" disabled={Boolean(linkingId)} aria-label={`选择图片 ${asset.title}`} title={asset.title} key={asset.id} onClick={() => void link(asset)}>{previewUrls[asset.id] ? <img src={previewUrls[asset.id]} alt="" /> : <Image size={28} />}{linkingId === asset.id && <span><LoaderCircle size={18} /></span>}</button>)}</div>)}
        </div> : <div className="asset-preview-state"><File size={26} /><span>没有可选图片</span></div>}
      </div>
    </section>
  </div>;
}
