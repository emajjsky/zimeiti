import { Check, CircleAlert, Download, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform } from '../../domain/creative';

function download(document: { content: string; format: 'HTML' | 'MARKDOWN' }, title: string, platform: CreativePlatform) {
  const blob = new Blob([document.content], { type: document.format === 'HTML' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a');
  anchor.href = url; anchor.download = `${title}-${platform.toLowerCase()}.${document.format === 'HTML' ? 'html' : 'md'}`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ReviewWorkspace({ project, activePlatform, onPlatform, onProjectChange }: {
  project: ContentProject;
  activePlatform: CreativePlatform;
  onPlatform: (platform: CreativePlatform) => void;
  onProjectChange: (project: ContentProject) => void;
}) {
  const [delivery, setDelivery] = useState(project.delivery);
  const [checked, setChecked] = useState<string[]>(project.delivery?.platforms?.[activePlatform]?.review?.acknowledgedFactChecks ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const platforms = useMemo(() => project.versions.filter((item) => item.platform !== 'VIDEO_CHANNEL').map((item) => item.platform as CreativePlatform), [project.versions]);
  const outstanding = project.factChecks ?? [];
  const currentDelivery = delivery?.platforms?.[activePlatform];
  const document = currentDelivery?.layout;
  const completed = currentDelivery?.stage === 'READY';

  useEffect(() => {
    let cancelled = false;
    webCreative.delivery(project.id).then((result) => { if (!cancelled) { setDelivery(result.delivery); setChecked(result.delivery.platforms?.[activePlatform]?.review?.acknowledgedFactChecks ?? []); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取审核状态失败。'); });
    return () => { cancelled = true; };
  }, [activePlatform, project.id]);

  const finish = async () => {
    setBusy(true); setError('');
    try { const result = await webCreative.completeReview(project.id, activePlatform, checked); setDelivery(result.delivery); onProjectChange(result.project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '完成审核失败。'); }
    finally { setBusy(false); }
  };
  const toggle = (claim: string) => setChecked((current) => current.includes(claim) ? current.filter((item) => item !== claim) : [...current, claim]);

  return <section className="review-workspace">
    <header className="delivery-workspace-head"><div><h2>{completed ? `${platformName[activePlatform]}发布包已就绪` : `${platformName[activePlatform]}发布前审核`}</h2><p>{completed ? '下载当前渠道发布稿，其他渠道可继续独立制作。' : '确认当前渠道正文、配图、排版和需要人工核对的事实。'}</p></div>{completed && <ShieldCheck size={26}/>}</header>
    {error && <div className="delivery-error" role="alert">{error}</div>}
    <div className="review-check-grid">
      <article className={project.versions.some((item) => item.platform === activePlatform && String(item.body ?? '').trim().length >= 80) ? 'passed' : 'failed'}><Check size={16}/><div><b>渠道正文</b><span>{platformName[activePlatform]}正文已准备</span></div></article>
      <article className={document ? 'passed' : 'failed'}><Check size={16}/><div><b>发布排版</b><span>{document ? '当前渠道已生成' : '尚未生成'}</span></div></article>
      <article className={currentDelivery?.visual ? 'passed' : 'neutral'}><Check size={16}/><div><b>配图素材</b><span>{currentDelivery?.visual?.assets.length ?? 0} 张已选</span></div></article>
    </div>
    {outstanding.length > 0 && !completed && <section className="review-fact-checks"><header><CircleAlert size={17}/><div><b>人工核对</b><span>以下内容不能由系统替代确认。</span></div></header>{outstanding.map((claim) => <label key={claim}><input type="checkbox" checked={checked.includes(claim)} onChange={() => toggle(claim)}/><span>{claim}</span></label>)}</section>}
    <nav className="delivery-platform-tabs" aria-label="下载发布稿">{platforms.map((platform) => <button type="button" className={platform === activePlatform ? 'active' : ''} key={platform} onClick={() => onPlatform(platform)}>{platformName[platform]}</button>)}</nav>
    {completed && document && <button className="button primary review-download" type="button" onClick={() => download(document, project.title, activePlatform)}><Download size={16}/>下载 {platformName[activePlatform]} 发布稿</button>}
    {!completed && <footer className="delivery-workspace-footer"><span>{outstanding.length ? `还需核对 ${outstanding.length - checked.filter((item) => outstanding.includes(item)).length} 项` : '没有待人工核对项'}</span><button className="button primary" type="button" disabled={busy || checked.filter((item) => outstanding.includes(item)).length !== outstanding.length || !document} onClick={() => void finish()}>{busy ? <LoaderCircle size={16}/> : <ShieldCheck size={16}/>}完成审核，生成发布包</button></footer>}
  </section>;
}
