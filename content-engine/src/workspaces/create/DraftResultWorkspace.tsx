import { CheckCircle2, CircleAlert, FileText, LoaderCircle, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webDrafts } from '../../data/webApi';
import type { ContentDraft, ContentDraftVersion, DraftAdaptationRun, DraftPlatform } from '../../domain/content-drafts';
import { draftSourceState } from '../../domain/platform-draft-editor.mjs';
import { PlatformDraftEditor } from './PlatformDraftEditor';

type SocialPlatform = Exclude<DraftPlatform, 'WECHAT'>;
const platforms: SocialPlatform[] = ['XIAOHONGSHU', 'WEIBO'];
const platformNames: Record<SocialPlatform, string> = { XIAOHONGSHU: '小红书', WEIBO: '微博' };
const runStatusNames: Record<DraftAdaptationRun['status'], string> = {
  DRAFT: '待确认', QUEUED: '已入队', RUNNING: '生成中', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消',
};

export function DraftResultWorkspace({ draft, version, derivedDrafts, activeDraftId, onActiveDraftChange, onDraftChange, onReloadDrafts, onPublish, onOpenModelSettings }: {
  draft: ContentDraft;
  version: ContentDraftVersion | null;
  derivedDrafts: ContentDraft[];
  activeDraftId: string;
  onActiveDraftChange: (draftId: string) => void;
  onDraftChange: (draft: ContentDraft) => void;
  onReloadDrafts: () => Promise<ContentDraft[]>;
  onPublish: () => void;
  onOpenModelSettings: () => void;
}) {
  const [runs, setRuns] = useState<Partial<Record<SocialPlatform, DraftAdaptationRun>>>({});
  const [busyPlatform, setBusyPlatform] = useState<SocialPlatform | null>(null);
  const [error, setError] = useState('');
  const handledRuns = useRef(new Set<string>());
  const currentVersionId = draft.currentVersionId ?? version?.id ?? null;
  const activeDraft = derivedDrafts.find(({ id }) => id === activeDraftId) ?? null;

  useEffect(() => {
    if (activeDraftId && !activeDraft) onActiveDraftChange('');
  }, [activeDraft, activeDraftId, onActiveDraftChange]);

  useEffect(() => {
    const activeRuns = platforms.flatMap((platform) => {
      const run = runs[platform];
      return run && (run.status === 'QUEUED' || run.status === 'RUNNING') ? [{ platform, run }] : [];
    });
    if (!activeRuns.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(activeRuns.map(async ({ platform, run }) => {
        const status = await webDrafts.adaptation(run.id);
        if (cancelled) return;
        if (status.status === 'SUCCEEDED' && status.result && !handledRuns.current.has(status.id)) {
          handledRuns.current.add(status.id);
          const listed = await onReloadDrafts();
          if (cancelled) return;
          setRuns((current) => ({ ...current, [platform]: { ...current[platform], ...status } }));
          if (listed.some(({ id }) => id === status.result?.draftId)) onActiveDraftChange(status.result.draftId);
          return;
        }
        setRuns((current) => ({ ...current, [platform]: { ...current[platform], ...status } }));
      })).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取平台适配任务失败。'); });
    }, 900);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onActiveDraftChange, onReloadDrafts, runs]);

  const platformDrafts = useMemo(() => Object.fromEntries(platforms.map((platform) => [platform, derivedDrafts.find((item) => item.platform === platform) ?? null])) as Record<SocialPlatform, ContentDraft | null>, [derivedDrafts]);

  const prepare = async (platform: SocialPlatform) => {
    if (!currentVersionId) { setError('公众号完成版本还没有读取成功，请稍后重试。'); return; }
    setBusyPlatform(platform); setError('');
    try {
      const run = await webDrafts.derive(draft.id, platform);
      setRuns((current) => ({ ...current, [platform]: run }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : `准备${platformNames[platform]}派生任务失败。`); }
    finally { setBusyPlatform(null); }
  };

  const confirm = async (platform: SocialPlatform) => {
    const run = runs[platform];
    if (!run) return;
    setBusyPlatform(platform); setError('');
    try {
      const confirmed = await webDrafts.confirmAdaptation(run.id);
      setRuns((current) => ({ ...current, [platform]: { ...run, ...confirmed } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : `启动${platformNames[platform]}派生任务失败。`); }
    finally { setBusyPlatform(null); }
  };

  const cancel = async (platform: SocialPlatform) => {
    const run = runs[platform];
    if (!run) return;
    setBusyPlatform(platform); setError('');
    try {
      const cancelled = await webDrafts.cancelAdaptation(run.id);
      setRuns((current) => ({ ...current, [platform]: { ...run, ...cancelled } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : `取消${platformNames[platform]}派生任务失败。`); }
    finally { setBusyPlatform(null); }
  };

  if (activeDraft) return <PlatformDraftEditor draft={activeDraft} currentSourceVersionId={currentVersionId} onDraftChange={onDraftChange} onBack={() => onActiveDraftChange('')} onOpenModelSettings={onOpenModelSettings}/>;

  return <section className="draft-result-workspace">
    <header><CheckCircle2 size={22}/><div><h2>公众号草稿已完成</h2><p>公众号是唯一母稿。排版版本已冻结，其他平台只从当前版本明确派生。</p></div><button className="button primary" type="button" onClick={onPublish}><Send size={15}/>去发布</button></header>
    {error && <div className="creative-stage-error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}
    <dl className="draft-result-summary">
      <div><dt>标题</dt><dd>{draft.title || '未命名草稿'}</dd></div>
      <div><dt>版本</dt><dd>{version ? `V${version.versionNumber}` : '已保存'}</dd></div>
      <div><dt>图片</dt><dd>{draft.assets.length} 张</dd></div>
      <div><dt>状态</dt><dd><FileText size={15}/>公众号母稿</dd></div>
    </dl>

    <section className="draft-result-content">
      <div className="draft-result-preview">
        <header><div><span>WECHAT / MASTER</span><h3>公众号排版预览</h3></div><b>{version ? `冻结于 V${version.versionNumber}` : '读取版本中'}</b></header>
        {version?.renderedHtml ? <iframe title="已完成公众号排版" sandbox="allow-same-origin" srcDoc={version.renderedHtml}/> : <div className="draft-result-preview-empty"><LoaderCircle size={22}/><span>正在读取公众号排版版本</span></div>}
      </div>

      <aside className="draft-adaptation-list" aria-label="派生平台草稿">
        <header><span>DERIVED DRAFTS</span><h3>转为其他平台</h3><p>只生成文字与图片草稿，不进入配图、排版或审核步骤。</p></header>
        {platforms.map((platform) => {
          const target = platformDrafts[platform];
          const sourceState = target ? draftSourceState(target, currentVersionId) : 'MISSING';
          const run = runs[platform];
          const active = run && ['QUEUED', 'RUNNING'].includes(run.status);
          return <article className="draft-adaptation-item" key={platform}>
            <div className="draft-adaptation-heading"><div><b>{platformNames[platform]}</b><span>文字 + 图片 · 最多 9 张</span></div>{target && <i className={`source-${sourceState.toLowerCase()}`}>{sourceState === 'CURRENT' ? '来源为当前版本' : '来源已过期'}</i>}</div>
            {target && <div className="draft-adaptation-meta"><span>{target.title || '未命名草稿'}</span><small>{target.body.length.toLocaleString('zh-CN')} 字 · {target.assets.length} 图</small></div>}
            {run?.confirmation && <div className="draft-adaptation-policy">
              <dl><div><dt>Scope</dt><dd>{run.confirmation.policy.scope}</dd></div><div><dt>Provider</dt><dd>{run.confirmation.policy.provider}</dd></div><div><dt>Model</dt><dd>{run.confirmation.policy.model}</dd></div><div><dt>Prompt version</dt><dd>{run.confirmation.policy.promptVersion}</dd></div></dl>
              <p>来源：公众号冻结版本 {run.confirmation.sourceDraftVersionId.slice(0, 8)} · {run.confirmation.sourceAssetCount} 张来源图</p>
            </div>}
            {run && run.status !== 'DRAFT' && <div className={`draft-adaptation-status status-${run.status.toLowerCase()}`}>{active ? <LoaderCircle size={15}/> : run.status === 'FAILED' ? <CircleAlert size={15}/> : <CheckCircle2 size={15}/>}<span>{runStatusNames[run.status]}{run.error ? `：${run.error}` : ''}</span></div>}
            <footer>
              {target && sourceState === 'CURRENT' && !active && <button className="button" type="button" onClick={() => onActiveDraftChange(target.id)}>编辑草稿</button>}
              {run?.status === 'DRAFT' ? <><button className="text-button" type="button" disabled={busyPlatform === platform} onClick={() => void cancel(platform)}>取消</button><button className="button primary" type="button" disabled={busyPlatform === platform} onClick={() => void confirm(platform)}>{busyPlatform === platform ? <LoaderCircle size={14}/> : <Sparkles size={14}/>}确认策略并生成</button></>
                : !active && <button className="button" type="button" disabled={busyPlatform === platform} onClick={() => void prepare(platform)}>{busyPlatform === platform ? <LoaderCircle size={14}/> : target && sourceState !== 'CURRENT' ? <RefreshCw size={14}/> : <Sparkles size={14}/>} {target && sourceState !== 'CURRENT' ? '基于当前母稿重新生成' : `生成${platformNames[platform]}草稿`}</button>}
            </footer>
          </article>;
        })}
      </aside>
    </section>
  </section>;
}
