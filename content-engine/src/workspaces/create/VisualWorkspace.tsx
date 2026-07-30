import { Check, Image, LoaderCircle, Save, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import type { ContentProject } from '../../domain/content';
import type { ProjectReference } from '../../domain/creative';

function usableVisualReference(item: ProjectReference) {
  return item.role === 'VISUAL' || item.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(item.url ?? '');
}

export function VisualWorkspace({ project, onProjectChange, onOpenMaterials, onComplete }: {
  project: ContentProject;
  onProjectChange: (project: ContentProject) => void;
  onOpenMaterials: () => void;
  onComplete: () => void;
}) {
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [selected, setSelected] = useState<string[]>(project.delivery?.visual?.assetReferenceIds ?? []);
  const [cover, setCover] = useState<string | null>(project.delivery?.visual?.coverReferenceId ?? null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [error, setError] = useState('');
  const assets = useMemo(() => references.filter(usableVisualReference), [references]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    webCreative.materials(project.id).then((result) => {
      if (!cancelled) setReferences(result.references);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取素材失败。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id]);

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
      const result = await webCreative.saveVisual(project.id, { coverReferenceId: selected.includes(cover ?? '') ? cover : selected[0] ?? null, assetReferenceIds: selected });
      onProjectChange(result.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存配图失败。'); }
    finally { setBusy(null); }
  };

  const complete = async () => {
    setBusy('complete'); setError('');
    try {
      const saved = await webCreative.saveVisual(project.id, { coverReferenceId: selected.includes(cover ?? '') ? cover : selected[0] ?? null, assetReferenceIds: selected });
      const result = await webCreative.completeVisual(project.id);
      onProjectChange(result.project ?? saved.project); onComplete();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认配图失败。'); }
    finally { setBusy(null); }
  };

  return <section className="visual-workspace">
    <header className="delivery-workspace-head">
      <div><h2>选择本篇配图</h2><p>从项目素材中选用，第一张作为封面。</p></div>
      <button className="button" type="button" onClick={onOpenMaterials}><Upload size={16}/>管理素材</button>
    </header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    {loading ? <div className="delivery-loading"><LoaderCircle size={18}/>读取素材</div> : assets.length ? <div className="visual-asset-grid">
      {assets.map((asset) => {
        const checked = selected.includes(asset.id);
        const isCover = cover === asset.id && checked;
        return <article className={`visual-asset-card${checked ? ' selected' : ''}`} key={asset.id}>
          <button className="visual-asset-main" type="button" onClick={() => toggle(asset.id)} aria-pressed={checked}>
            <span className="visual-asset-icon"><Image size={22}/></span><b>{asset.title}</b><small>{asset.sourceType === 'FILE' ? '已上传图片' : '图片链接'}</small>
          </button>
          {checked && <button className={`visual-cover-toggle${isCover ? ' active' : ''}`} type="button" onClick={() => setCover(asset.id)}>{isCover ? <><Check size={14}/>封面</> : '设为封面'}</button>}
        </article>;
      })}
    </div> : <section className="delivery-empty"><Image size={24}/><b>还没有可用图片</b><p>在素材库上传图片，或添加视觉参考链接后再回来选择。</p></section>}
    <footer className="delivery-workspace-footer">
      <span>{selected.length ? `已选 ${selected.length} 张${cover ? '，已设封面' : ''}` : '本篇暂不使用配图'}</span>
      <div><button className="button" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16}/> : <Save size={16}/>}保存</button><button className="button primary" type="button" disabled={busy !== null} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : null}确认配图，进入排版</button></div>
    </footer>
  </section>;
}
