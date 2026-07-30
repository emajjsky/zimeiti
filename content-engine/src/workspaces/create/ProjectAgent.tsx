import { Bot, Check, CircleAlert, Eye, FileCheck2, LoaderCircle, Search, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { copyActionPanelState, copyActionRequest, type CopyPanelAction } from '../../domain/copy-action-panel.mjs';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform, ProjectAgentContext, ProjectArtifact, ResearchResult } from '../../domain/creative';

type ProjectAgentProps = {
  projectId: string;
  stage: 'RESEARCH' | 'COPY';
  platform?: CreativePlatform;
  selectedMaterials?: { inputIds: string[]; referenceIds: string[] };
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

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function artifactHeading(artifact: ProjectArtifact) {
  const title = artifact.payload.title;
  if (typeof title === 'string' && title.trim()) return title;
  const options = strings(artifact.payload.titleOptions);
  if (options[0]) return options[0];
  return artifact.type === 'OUTLINE' ? '文案大纲' : '文案候选';
}

export function ProjectAgent(props: ProjectAgentProps) {
  if (props.stage === 'RESEARCH') return <SimplifiedResearchAgent {...props}/>;
  return <CopyProjectAgent {...props}/>;
}

function SimplifiedResearchAgent({ projectId, refreshToken = 0, onContextChange, onArtifactAccepted, onOpenSettings }: ProjectAgentProps) {
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [request, setRequest] = useState('');
  const [showResearchSupplement, setShowResearchSupplement] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'loading' | 'starting' | 'accepting' | 'skipping'>('loading');
  const [error, setError] = useState('');

  const reload = async () => {
    const result = await webCreative.agentContext(projectId, { stage: 'RESEARCH', history: 'CURRENT' });
    setContext(result); onContextChange?.(result);
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

  const resultArtifact = useMemo(() => (context?.artifacts ?? []).find((artifact) => artifact.type === 'RESEARCH_RESULT' && artifact.status === 'CANDIDATE') ?? null, [context?.artifacts]);
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

  return <aside className="simplified-research" aria-label="资料研究">
    <header className="simplified-research-head"><div><Bot size={19}/><div><h2>资料研究</h2><span>{result ? '研究结果已就绪' : isRunning ? researchRunLabel(activeRun?.confirmation.phase) : '用已保存资料补足外部事实'}</span></div></div></header>
    {busy === 'loading' && <div className="simplified-research-skeleton" aria-label="正在读取研究状态"><i/><i/><i/></div>}
    {busy !== 'loading' && isRunning && <div className="simplified-research-running" aria-live="polite"><LoaderCircle size={18}/><div><b>{researchRunLabel(activeRun?.confirmation.phase)}</b><span>{activeRun?.status === 'QUEUED' ? '任务已排队' : '完成后会自动显示结果'}</span></div></div>}
    {busy !== 'loading' && !isRunning && resultArtifact && result && <ResearchResultPreview result={result} busy={busy !== 'idle'} onAccept={() => void acceptResearchResult()}/>}
    {busy !== 'loading' && !isRunning && !resultArtifact && <div className="simplified-research-empty"><FileCheck2 size={22}/><b>还没有研究结果</b><span>可直接开始，项目资料会自动带入。</span></div>}
    {error && <div className="simplified-research-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/(模型|核心 Agent|Key)/.test(error) && <button className="text-button" type="button" onClick={() => onOpenSettings('agent')}><Settings2 size={14}/>去配置</button>}</div>}
    {!isRunning && <footer className="simplified-research-actions">
      {(!resultArtifact || showResearchSupplement) && <label><span>{resultArtifact ? '补充方向（可选）' : '研究重点（可选）'}</span><textarea rows={resultArtifact ? 1 : 2} value={request} maxLength={2_000} placeholder="不填则沿用当前项目上下文" onChange={(event) => setRequest(event.target.value)}/></label>}
      <div>{!resultArtifact && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void skipResearch()}>无需研究，直接进入正文</button>}{resultArtifact && !showResearchSupplement && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => setShowResearchSupplement(true)}>补充研究</button>}{(!resultArtifact || showResearchSupplement) && <button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void startResearch()}>{busy === 'starting' ? <LoaderCircle size={16}/> : <Search size={16}/>}{showResearchSupplement ? '开始补充' : '开始研究'}</button>}</div>
    </footer>}
  </aside>;
}

function ResearchResultPreview({ result, busy, onAccept }: { result: ResearchResult; busy: boolean; onAccept: () => void }) {
  const verifiedFacts = result.facts.filter((item) => item.status === 'VERIFIED');
  const singleSource = [...result.facts, ...result.cautions].filter((item) => item.status === 'SINGLE_SOURCE');
  const needsReview = result.cautions.filter((item) => item.status !== 'SINGLE_SOURCE');
  return <section className="research-result-preview">
    <p className="research-result-summary">{researchResultSummary(result)}</p>
    <ResultList title="可直接使用" items={verifiedFacts} empty="还没有可直接写入正文的事实。" tone="verified"/>
    <ResultList title="可参考（单一来源）" items={singleSource} empty="没有单一来源事实。" tone="single-source"/>
    <ResultList title="需要补充核验" items={needsReview} empty="没有需要补充核验的事实。" tone="caution"/>
    <ResultList title="正文角度" items={result.angles} empty="可根据规划直接展开正文。" tone="angle"/>
    <details className="research-result-details"><summary>来源与研究说明</summary><div>{result.sources.map((source) => <a key={source.id} href={source.url ?? undefined} target={source.url ? '_blank' : undefined} rel="noreferrer">{source.source}：{source.title}</a>)}</div></details>
    <footer><button className="button primary" type="button" disabled={busy} onClick={onAccept}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}采用并进入正文</button></footer>
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

function CopyProjectAgent({ projectId, stage, platform, selectedMaterials, selection, hasAcceptedCopy = false, blockedReason, refreshToken = 0, onClearSelection, onContextChange, onArtifactOpen, onOpenSettings }: ProjectAgentProps) {
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'idle' | 'loading' | 'starting' | 'cancelling'>('loading');
  const [error, setError] = useState('');
  const openedCandidateId = useRef<string | null>(null);

  const reload = async () => {
    const result = await webCreative.agentContext(projectId, { stage, platform, history: 'CURRENT' });
    setContext(result); onContextChange?.(result);
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
  useEffect(() => {
    if (!candidate || openedCandidateId.current === candidate.id || !onArtifactOpen) return;
    openedCandidateId.current = candidate.id;
    onArtifactOpen(candidate);
  }, [candidate, onArtifactOpen]);

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
    {busy !== 'loading' && candidate && <section className="copy-action-candidate"><div><b>{candidate.type === 'OUTLINE' ? '大纲候选已生成' : '正文候选已生成'}</b><span>正式文稿尚未改变</span></div><button className="button" type="button" onClick={openCandidate}><Eye size={15}/>查看并采用</button></section>}
    {busy !== 'loading' && activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(activeRun.status) && <section className="copy-action-running" aria-live="polite"><LoaderCircle size={18}/><div><b>{activeRun.status === 'RUNNING' ? '正在生成正文候选' : '正文任务已排队'}</b><span>完成后会自动打开候选审核</span></div>{['DRAFT', 'QUEUED'].includes(activeRun.status) && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>{busy === 'cancelling' ? '取消中' : '取消'}</button>}</section>}
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

function ArtifactPreview({ artifact, selectedTitle, onTitle, busy, onAccept, onClose }: { artifact: ProjectArtifact; selectedTitle: string; onTitle: (value: string) => void; busy: boolean; onAccept: () => void; onClose: () => void }) {
  const titleOptions = strings(artifact.payload.titleOptions);
  const facts = strings(artifact.payload.factsToVerify);
  const review = artifact.payload.qualityReview;
  const reviewIssues = review && typeof review === 'object' && (review as Record<string, unknown>).status === 'NEEDS_REVIEW' ? strings((review as Record<string, unknown>).issues) : [];
  const verificationItems = [...new Set([...reviewIssues, ...facts].map((item) => item.trim()).filter(Boolean))];
  const [verificationOpen, setVerificationOpen] = useState(false);
  const body = typeof artifact.payload.body === 'string' ? artifact.payload.body : '';
  const summary = typeof artifact.payload.summary === 'string' ? artifact.payload.summary : typeof artifact.payload.changeSummary === 'string' ? artifact.payload.changeSummary : '';
  const canAccept = artifact.status === 'CANDIDATE' && ['OUTLINE', 'PLATFORM_COPY'].includes(artifact.type);
  return <div className="agent-artifact-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="agent-artifact-preview" role="dialog" aria-modal="true" aria-labelledby="agent-artifact-title">
      <header><div><span>{artifact.platform ? platformName[artifact.platform] : '项目'}</span><h2 id="agent-artifact-title">{artifactHeading(artifact)}</h2></div><button className="icon-button" type="button" aria-label="关闭候选" onClick={onClose}><X size={18}/></button></header>
      <div className="agent-artifact-body">
        {titleOptions.length > 0 && <label><span>标题方案</span><select value={selectedTitle} onChange={(event) => onTitle(event.target.value)}>{titleOptions.map((title) => <option key={title}>{title}</option>)}</select></label>}
        {summary && <p className="artifact-summary">{summary}</p>}
        {verificationItems.length > 0 && <section className="candidate-verification artifact-verification"><header><div><b>发布前核验</b><span>{verificationItems.length} 项待处理</span></div><button type="button" aria-expanded={verificationOpen} onClick={() => setVerificationOpen((current) => !current)}>{verificationOpen ? '收起' : '查看核验项'}</button></header>{verificationOpen && <ul>{verificationItems.map((item) => <li key={item}>{item}</li>)}</ul>}</section>}
        {body && <div className="artifact-copy"><h3>{artifactHeading(artifact)}</h3><p>{body}</p></div>}
      </div>
      <footer><button className="button" type="button" disabled={busy} onClick={onClose}>关闭</button>{canAccept && <button className="button primary" type="button" disabled={busy || (artifact.type === 'OUTLINE' && !selectedTitle)} onClick={onAccept}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}采用到正文</button>}</footer>
    </section>
  </div>;
}
