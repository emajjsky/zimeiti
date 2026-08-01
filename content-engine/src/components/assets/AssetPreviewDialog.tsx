import { Download, File, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webAssets } from '../../data/webApi';
import type { WorkspaceAsset } from '../../domain/assets';

export function AssetPreviewDialog({ asset, onClose, externalUrl }: { asset: WorkspaceAsset; onClose: () => void; externalUrl?: string }) {
  const [url, setUrl] = useState(externalUrl ?? '');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (externalUrl) { setUrl(externalUrl); setError(''); return; }
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    void webAssets.content(asset.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '素材预览加载失败。');
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id, attempt, externalUrl]);

  const content = error
    ? <div className="asset-preview-state error" role="alert"><File size={30}/><b>素材预览加载失败</b><span>{error}</span><button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15}/>重试</button></div>
    : !url
      ? <div className="asset-preview-state"><LoaderCircle size={28}/><span>正在读取素材</span></div>
      : asset.mimeType.startsWith('image/')
        ? <img className="asset-preview-image" src={url} alt={asset.title}/>
        : asset.mimeType === 'application/pdf'
          ? <iframe className="asset-preview-document" src={url} title={asset.title} sandbox="allow-same-origin"/>
          : asset.mimeType.startsWith('audio/')
            ? <audio className="asset-preview-audio" src={url} controls/>
            : asset.mimeType.startsWith('video/')
              ? <video className="asset-preview-video" src={url} controls/>
              : <div className="asset-preview-state"><File size={30}/><b>{asset.originalFilename}</b><span>此文件类型不支持在线预览</span><a className="button" href={url} download={asset.originalFilename}><Download size={15}/>下载文件</a></div>;

  return <div className="asset-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="asset-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-preview-title">
      <header><div><h2 id="asset-preview-title">{asset.title}</h2><span>{asset.originalFilename} · {asset.mimeType}</span></div><button className="icon-button" type="button" aria-label="关闭素材预览" onClick={onClose}><X size={18}/></button></header>
      <div className="asset-preview-content">{content}</div>
      <footer><span>{asset.projectCount} 个项目正在使用</span>{url && !externalUrl && <a className="button" href={url} download={asset.originalFilename}><Download size={15}/>下载</a>}</footer>
    </section>
  </div>;
}
