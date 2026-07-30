import { Check, Download, FileText, LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform } from '../../domain/creative';

function download(document: { content: string; format: 'HTML' | 'MARKDOWN' }, title: string, platform: CreativePlatform) {
  const suffix = document.format === 'HTML' ? 'html' : 'md';
  const blob = new Blob([document.content], { type: document.format === 'HTML' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = `${title}-${platform.toLowerCase()}.${suffix}`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function LayoutWorkspace({ project, activePlatform, onPlatform, onProjectChange, onComplete }: {
  project: ContentProject;
  activePlatform: CreativePlatform;
  onPlatform: (platform: CreativePlatform) => void;
  onProjectChange: (project: ContentProject) => void;
  onComplete: () => void;
}) {
  const platforms = useMemo(() => project.versions.filter((item): item is typeof item & { platform: CreativePlatform } => item.platform !== 'VIDEO_CHANNEL').map((item) => item.platform), [project.versions]);
  const [delivery, setDelivery] = useState(project.delivery);
  const [busy, setBusy] = useState<'generate' | 'complete' | null>(null);
  const [error, setError] = useState('');
  const document = delivery?.layouts?.[activePlatform];

  useEffect(() => {
    let cancelled = false;
    webCreative.delivery(project.id).then((result) => { if (!cancelled) setDelivery(result.delivery); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取排版状态失败。'); });
    return () => { cancelled = true; };
  }, [project.id]);

  const generate = async () => {
    setBusy('generate'); setError('');
    try { const result = await webCreative.generateLayout(project.id); setDelivery(result.delivery); onProjectChange(result.project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '生成排版失败。'); }
    finally { setBusy(null); }
  };
  const complete = async () => {
    setBusy('complete'); setError('');
    try { const result = await webCreative.completeLayout(project.id); onProjectChange(result.project); onComplete(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '确认排版失败。'); }
    finally { setBusy(null); }
  };

  return <section className="layout-workspace">
    <header className="delivery-workspace-head"><div><h2>生成发布排版</h2><p>正文和已选配图会整理为各平台可复制、可下载的发布稿。</p></div><button className="button primary" type="button" disabled={busy !== null} onClick={() => void generate()}>{busy === 'generate' ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成排版预览</button></header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    <nav className="delivery-platform-tabs" aria-label="发布平台">{platforms.map((platform) => <button type="button" className={platform === activePlatform ? 'active' : ''} key={platform} onClick={() => onPlatform(platform)}>{platformName[platform]}</button>)}</nav>
    {document ? <section className="layout-preview"><header><div><b>{document.format === 'HTML' ? 'HTML 发布稿' : 'Markdown 发布稿'}</b><span>已生成</span></div><button className="button" type="button" onClick={() => download(document, project.title, activePlatform)}><Download size={16}/>下载</button></header><pre>{document.content}</pre></section> : <section className="delivery-empty"><FileText size={24}/><b>还没有排版预览</b><p>生成后可查看并下载各平台发布稿。</p></section>}
    <footer className="delivery-workspace-footer"><span>{document ? '确认后进入发布前审核' : '先生成排版预览'}</span><button className="button primary" type="button" disabled={!document || busy !== null} onClick={() => void complete()}>{busy === 'complete' ? <LoaderCircle size={16}/> : <Check size={16}/>}确认排版，进入审核</button></footer>
  </section>;
}
