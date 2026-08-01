import { Bot, Check, CircleAlert, FileCheck2, LoaderCircle, Search, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative, webProjects } from '../../data/webApi';
import { copyActionPanelState, copyActionRequest, type CopyPanelAction } from '../../domain/copy-action-panel.mjs';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform, ProjectAgentContext, ProjectArtifact, ResearchResult } from '../../domain/creative';
import { selectCurrentResearchArtifact } from '../../domain/research-result-selection.mjs';

type ProjectAgentProps = {
  projectId: string;
  stage: 'RESEARCH' | 'COPY';
  platform?: CreativePlatform;
  selectedMaterials?: { inputIds: string[]; referenceIds: string[]; assetIds: string[] };
  selection?: { text: string; start: number; end: number };
  hasAcceptedCopy?: boolean;
  blockedReason?: string;
  refreshToken?: number;
  onClearSelection?: () => void;
  onContextChange?: (context: ProjectAgentContext) => void;
  onArtifactOpen?: (artifact: ProjectArtifact) => void;
  onArtifactAccepted: (artifact: ProjectArtifact, project?: ContentProject) => void;
  onOpenSettings: (target: 'agent' | 'policies' | 'search') => void;
};

export function ProjectAgent(props: ProjectAgentProps) {
  if (props.stage === 'RESEARCH') return <SimplifiedResearchAgent {...props}/>;
  return <CopyProjectAgent {...props}/>;
}

function SimplifiedResearchAgent({ projectId, refreshToken = 0, onContextChange, onArtifactAccepted, onOpenSettings }: ProjectAgentProps) {
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [request, setRequest] = useState('');
  const [showResearchSupplement, setShowResearchSupplement] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'loading' | 'starting' | 'accepting' | 'skipping' | 'cancelling'>('loading');
  const [error, setError] = useState('');

  const reload = async () => {
    const result = await webCreative.agentContext(projectId, { stage: 'RESEARCH', history: 'CURRENT' });
    setContext(result); setError(''); onContextChange?.(result);
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    setBusy('loading'); setError('');
    void webCreative.agentContext(projectId, { stage: 'RESEARCH', history: 'CURRENT' })
      .then((result) => { if (!cancelled) { setContext(result); onContextChange?.(result); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取研究状态失败。'); })
      .finally(() => { if (!cancelled) setBusy('idle'); });
    return () => { cancelled = true; };
  }, [projectId, refreshToken]);

  const activeRun = context?.activeRun;
  const isRunning = Boolean(activeRun && ['QUEUED', 'RUNNING'].includes(activeRun.status));
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : '研究状态更新失败。')); }, 1_500);
    return () => window.clearInterval(timer);
  }, [isRunning, projectId]);

  const resultArtifact = useMemo(() => selectCurrentResearchArtifact(context?.artifacts ?? []), [context?.artifacts]);
  const result = resultArtifact ? asResearchResult(resultArtifact.payload) : null;

  const startResearch = async () => {
    if (busy !== 'idle' || isRunning) return;
    setBusy('starting'); setError('');
    try {
      await webCreative.startResearch(projectId, request.trim() ? { request: request.trim() } : {});
      setRequest(''); setShowResearchSupplement(false);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '开始研究失败。'); }
    finally { setBusy('idle'); }
  };

  const acceptResearchResult = async () => {
    if (!resultArtifact || busy !== 'idle') return;
    setBusy('accepting'); setError('');
    try {
      const accepted = await webCreative.acceptResearchResult(resultArtifact.id);
      onArtifactAccepted(accepted.artifact, accepted.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '采用研究结果失败。'); }
    finally { setBusy('idle'); }
  };

  const skipResearch = async () => {
    if (busy !== 'idle') return;
    setBusy('skipping'); setError('');
    try {
      const skipped = await webCreative.skipResearch(projectId);
      onArtifactAccepted({ id: 'research-skipped', type: 'RESEARCH_RESULT', status: 'ACCEPTED', platform: null, version: 1, parentArtifactId: null, payload: {}, createdAt: new Date().toISOString(), acceptedAt: new Date().toISOString() }, skipped.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '跳过研究失败。'); }
    finally { setBusy('idle'); }
  };

  const cancelResearch = async () => {
    if (!activeRun || busy !== 'idle') return;
    setBusy('cancelling'); setError('');
    try { await webCreative.cancelAgentRun(activeRun.id); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消研究失败。'); }
    finally { setBusy('idle'); }
  };

  return <aside className="simplified-research" aria-label="资料研究">
    <header className="simplified-research-head"><div><Bot size={19}/><div><h2>资料研究</h2><span>{result ? '研究结果已就绪' : isRunning ? researchRunLabel(activeRun?.confirmation.phase) : '用已保存资料补足外部事实'}</span></div></div></header>
    {busy === 'loading' && <div className="simplified-research-skeleton" aria-label="正在读取研究状态"><i/><i/><i/></div>}
    {busy !== 'loading' && isRunning && <div className="simplified-research-running" aria-live="polite"><LoaderCircle size={18}/><div><b>{researchRunLabel(activeRun?.confirmation.phase)}</b><span>{activeRun?.status === 'QUEUED' ? '任务已排队' : '完成后会自动显示结果'}</span></div><button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancelResearch()}>{busy === 'cancelling' ? '取消中' : '取消任务'}</button></div>}
    {busy !== 'loading' && !isRunning && resultArtifact && result && <ResearchResultPreview result={result} accepted={resultArtifact.status === 'ACCEPTED'} busy={busy !== 'idle'} onAccept={() => void acceptResearchResult()}/>}
    {busy !== 'loading' && !isRunning && !resultArtifact && <div className="simplified-research-empty"><FileCheck2 size={22}/><b>还没有研究结果</b><span>可直接开始，项目资料会自动带入。</span></div>}
    {error && <div className="simplified-research-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/(模型|核心 Agent|Key)/.test(error) && <button className="text-button" type="button" onClick={() => onOpenSettings('agent')}><Settings2 size={14}/>去配置</button>}</div>}
    {!isRunning && <footer className="simplified-research-actions">
      {(!resultArtifact || showResearchSupplement) && <label><span>{resultArtifact ? '补充方向（可选）' : '研究重点（可选）'}</span><textarea rows={resultArtifact ? 1 : 2} value={request} maxLength={2_000} placeholder="不填则沿用当前项目上下文" onChange={(event) => setRequest(event.target.value)}/></label>}
      <div>{!resultArtifact && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void skipResearch()}>无需研究，直接进入正文</button>}{resultArtifact && !showResearchSupplement && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => setShowResearchSupplement(true)}>补充研究</button>}{(!resultArtifact || showResearchSupplement) && <button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void startResearch()}>{busy === 'starting' ? <LoaderCircle size={16}/> : <Search size={16}/>}{showResearchSupplement ? '开始补充' : '开始研究'}</button>}</div>
    </footer>}
  </aside>;
}

function ResearchResultPreview({ result, accepted, busy, onAccept }: { result: ResearchResult; accepted: boolean; busy: boolean; onAccept: () => void }) {
  const verifiedFacts = result.facts.filter((item) => item.status === 'VERIFIED');
  const singleSource = [...result.facts, ...result.cautions].filter((item) => item.status === 'SINGLE_SOURCE');
  const needsReview = result.cautions.filter((item) => item.status !== 'SINGLE_SOURCE');
  return <section className="research-result-preview">
    <p className="research-result-summary">{researchResultSummary(result)}</p>
    {result.researchBrief && <ResearchBriefPreview brief={result.researchBrief}/>}
    <ResultList title="可直接使用" items={verifiedFacts} empty="还没有可直接写入正文的事实。" tone="verified"/>
    <ResultList title="可参考（单一来源）" items={singleSource} empty="没有单一来源事实。" tone="single-source"/>
    <ResultList title="需要补充核验" items={needsReview} empty="没有需要补充核验的事实。" tone="caution"/>
    <details className="research-result-details"><summary>来源与研究说明</summary><div>{result.sources.map((source) => <a key={source.id} href={source.url ?? undefined} target={source.url ? '_blank' : undefined} rel="noreferrer">{source.source}：{source.title}</a>)}</div></details>
    {!accepted && <footer><button className="button primary" type="button" disabled={busy} onClick={onAccept}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}采用并进入正文</button></footer>}
  </section>;
}

function ResearchBriefPreview({ brief }: { brief: NonNullable<ResearchResult['researchBrief']> }) {
  return <section className="research-brief-preview" aria-label="本次研究范围">
    <header><span>研究主体</span><b>{brief.subject}</b></header>
    <dl>
      <div><dt>方向</dt><dd>{brief.directions.map((item) => <span key={item}>{item}</span>)}</dd></div>
      <div><dt>关键词</dt><dd>{brief.keywords.map((item) => <span key={item}>{item}</span>)}</dd></div>
      <div><dt>渠道</dt><dd>{brief.preferredChannels.map((item) => <span key={item}>{item}</span>)}</dd></div>
    </dl>
    <details><summary>查看查询词</summary><ol>{brief.searchQueries.map((item) => <li key={item}>{item}</li>)}</ol></details>
  </section>;
}

type ResearchClaimItem = ResearchResult['facts'][number] | ResearchResult['cautions'][number];

function ResultList({ title, items, empty, tone }: { title: string; items: string[] | ResearchClaimItem[]; empty: string; tone: 'verified' | 'single-source' | 'caution' | 'angle' }) {
  return <section className={`research-result-list ${tone}`}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => {
    const claim = typeof item === 'string' ? item : item.claim;
    const explanation = typeof item === 'string' ? '' : item.explanation;
    return <li key={claim}><span>{claim}</span>{explanation && <small>{explanation}</small>}</li>;
  })}</ul> : <p>{empty}</p>}</section>;
}

function researchResultSummary(result: ResearchResult) {
  const verifiedFacts = result.facts.filter((item) => item.status === 'VERIFIED').length;
  const singleSource = [...result.facts, ...result.cautions].filter((item) => item.status === 'SINGLE_SOURCE').length;
  const needsReview = result.cautions.filter((item) => item.status !== 'SINGLE_SOURCE').length;
  if (!result.sources.length) return '还没有读取到可用来源，暂时不能形成事实结论。';
  return `已整理 ${result.sources.length} 条来源：${verifiedFacts} 条可直接使用，${singleSource} 条可参考，${needsReview} 条需要补充核验。`;
}

function asResearchResult(payload: Record<string, unknown>): ResearchResult | null {
  return typeof payload.summary === 'string' && Array.isArray(payload.facts) && Array.isArray(payload.cautions) && Array.isArray(payload.angles) && Array.isArray(payload.sources) && payload.materialContext && typeof payload.materialContext === 'object' && payload.process && typeof payload.process === 'object'
    ? payload as unknown as ResearchResult : null;
}

function researchRunLabel(phase: string | undefined) {
  return phase === 'VERIFYING' ? '正在核验' : phase === 'SOURCES' ? '正在检索' : phase === 'PLANNING' ? '正在整理' : '正在研究';
}

function CopyProjectAgent({ projectId, stage, platform, selectedMaterials, selection, hasAcceptedCopy = false, blockedReason, refreshToken = 0, onClearSelection, onContextChange, onArtifactOpen, onArtifactAccepted, onOpenSettings }: ProjectAgentProps) {
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'idle' | 'loading' | 'starting' | 'cancelling'>('loading');
  const [error, setError] = useState('');
  const watchedRun = useRef<{ id: string; action: string } | null>(null);

  const reload = async () => {
    const result = await webCreative.agentContext(projectId, { stage, platform, history: 'CURRENT' });
    setContext(result); onContextChange?.(result);
    if (result.activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(result.activeRun.status)) {
      watchedRun.current = { id: result.activeRun.id, action: result.activeRun.action };
    } else if (watchedRun.current?.action === 'GENERATE_DRAFT') {
      const accepted = result.artifacts.find((artifact) => artifact.type === 'PLATFORM_COPY' && artifact.platform === platform && artifact.status === 'ACCEPTED');
      if (accepted) {
        const refreshed = await webProjects.planning(projectId);
        onArtifactAccepted(accepted, refreshed.project);
      }
      watchedRun.current = null;
    }
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    setBusy('loading'); setError(''); setContext(null);
    void webCreative.agentContext(projectId, { stage, platform, history: 'CURRENT' })
      .then((result) => { if (!cancelled) { setContext(result); onContextChange?.(result); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取文案状态失败。'); })
      .finally(() => { if (!cancelled) setBusy('idle'); });
    return () => { cancelled = true; };
  }, [platform, projectId, refreshToken, stage]);

  const activeRun = context?.activeRun;
  const runIsActive = Boolean(activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(activeRun.status));
  useEffect(() => {
    if (!runIsActive) return;
    const timer = window.setInterval(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : '文案状态更新失败。')); }, 1_500);
    return () => window.clearInterval(timer);
  }, [runIsActive, platform, projectId, stage]);

  const candidate = useMemo(() => (context?.artifacts ?? []).find((artifact) => (artifact.type === 'OUTLINE' || artifact.type === 'PLATFORM_COPY') && artifact.platform === platform && artifact.status === 'CANDIDATE') ?? null, [context?.artifacts, platform]);
  const panel = copyActionPanelState({ hasAcceptedCopy, hasSelection: Boolean(selection?.text), hasCandidate: Boolean(candidate) });
  const disabled = busy !== 'idle' || Boolean(blockedReason) || runIsActive;

  const openCandidate = () => { if (candidate && onArtifactOpen) onArtifactOpen(candidate); };

  const startAction = async (action: CopyPanelAction) => {
    if (disabled) return;
    setBusy('starting'); setError('');
    try {
      const prepared = await webCreative.prepareAgent(projectId, {
        stage,
        ...(platform ? { platform } : {}),
        request: copyActionRequest(action, note),
        ...(selection ? { selection } : {}),
        inputIds: selectedMaterials?.inputIds ?? [],
        referenceIds: selectedMaterials?.referenceIds ?? [],
        assetIds: selectedMaterials?.assetIds ?? [],
      });
      if ('needsClarification' in prepared) throw new Error(prepared.message.content);
      await webCreative.confirmAgentRun(prepared.id);
      setNote('');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '文案任务启动失败。'); }
    finally { setBusy('idle'); }
  };

  const cancel = async () => {
    if (!activeRun || !['DRAFT', 'QUEUED'].includes(activeRun.status)) return;
    setBusy('cancelling'); setError('');
    try { await webCreative.cancelAgentRun(activeRun.id); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消失败。'); }
    finally { setBusy('idle'); }
  };

  return <aside className="copy-action-panel" aria-label="文案助手">
    <header className="copy-action-panel-head"><div><Bot size={19}/><div><h2>文案助手</h2><span>{platform ? platformName[platform] : '当前平台'}</span></div></div></header>
    {busy === 'loading' && <div className="copy-action-loading" aria-label="正在读取文案状态"><i/><i/></div>}
    {busy !== 'loading' && candidate && <section className="copy-action-candidate"><div><b>{candidate.type === 'OUTLINE' ? '大纲候选已生成' : '修改版本已生成'}</b><span>当前正文保持不变</span></div><button className="button" type="button" onClick={openCandidate}>查看修改</button></section>}
    {busy !== 'loading' && activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(activeRun.status) && <section className="copy-action-running" aria-live="polite"><LoaderCircle size={18}/><div><b>{activeRun.status === 'RUNNING' ? (activeRun.action === 'GENERATE_DRAFT' ? '正在生成正文' : '正在生成修改版本') : '任务已排队'}</b><span>{activeRun.action === 'GENERATE_DRAFT' ? 'Agent 正在准备资料并生成最终成稿' : '完成后可查看修改差异'}</span></div>{['DRAFT', 'QUEUED'].includes(activeRun.status) && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>{busy === 'cancelling' ? '取消中' : '取消'}</button>}</section>}
    {busy !== 'loading' && !candidate && !runIsActive && <div className="copy-action-body">
      {panel.quickActions.length > 0 && <div className="copy-action-quick" aria-label="快捷修改">{panel.quickActions.map((item) => <button key={item.action} type="button" className="text-button" disabled={disabled} onClick={() => void startAction(item.action)}>{item.label}</button>)}</div>}
      {(hasAcceptedCopy || Boolean(selection?.text)) && <label className="copy-action-note"><span>{selection?.text ? `修改选中 ${selection.text.length} 字` : '补充要求（可选）'}</span><textarea rows={3} value={note} maxLength={2_000} placeholder={selection?.text ? '例如：语气更有说服力，保留事实' : '例如：更口语化，保留已有案例'} onChange={(event) => setNote(event.target.value)}/>{selection?.text && onClearSelection && <button className="text-button" type="button" onClick={onClearSelection}>取消选区</button>}</label>}
      <button className="button primary copy-action-primary" type="button" disabled={disabled} onClick={() => panel.primary.action === 'REVIEW_CANDIDATE' ? openCandidate() : void startAction(panel.primary.action)}>{busy === 'starting' ? <LoaderCircle size={16}/> : <Check size={16}/>}{panel.primary.label}</button>
      {!hasAcceptedCopy && <button className="text-button copy-action-outline" type="button" disabled={disabled} onClick={() => void startAction('GENERATE_OUTLINE')}>先生成大纲</button>}
    </div>}
    {blockedReason && <div className="copy-action-blocked"><CircleAlert size={16}/><span>{blockedReason}</span></div>}
    {error && <div className="copy-action-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/(模型|提示词|核心 Agent|Key)/.test(error) && <button className="text-button" type="button" onClick={() => onOpenSettings(/核心 Agent/.test(error) ? 'agent' : 'policies')}>去配置</button>}</div>}
  </aside>;
}
