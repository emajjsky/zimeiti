import { Bot, Check, CircleAlert, ExternalLink, Eye, FileCheck2, LoaderCircle, Search, Send, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { canPrepareAgentRequest, messagesForAgentThread, researchQuickAction } from '../../domain/project-agent-composer.mjs';
import { allCapturedSourceIds, initialSourceSelection, toggleSourceSelection } from '../../domain/research-source-selection.mjs';
import { platformName, type ContentProject } from '../../domain/content';
import type { CreativePlatform, ProjectAgentContext, ProjectAgentHistory, ProjectAgentMessageType, ProjectArtifact } from '../../domain/creative';

type ProjectAgentProps = {
  projectId: string;
  stage: 'RESEARCH' | 'COPY';
  platform?: CreativePlatform;
  selectedMaterials?: { inputIds: string[]; referenceIds: string[] };
  selection?: { text: string; start: number; end: number };
  blockedReason?: string;
  refreshToken?: number;
  onClearSelection?: () => void;
  onContextChange?: (context: ProjectAgentContext) => void;
  onArtifactOpen?: (artifact: ProjectArtifact) => void;
  onArtifactAccepted: (artifact: ProjectArtifact, project?: ContentProject) => void;
  onOpenSettings: (target: 'agent' | 'policies' | 'search') => void;
};

const actionNames = {
  PROJECT_RESEARCH_PLAN: '生成研究计划',
  PROJECT_RESEARCH_SOURCES: '查找研究来源',
  SOURCE_VERIFICATION: '核验研究事实',
  PROJECT_RESEARCH_WORKFLOW: '开始研究',
  GENERATE_OUTLINE: '生成大纲',
  GENERATE_DRAFT: '生成正文',
  POLISH_EXISTING_DRAFT: '润色文案',
  RESTRUCTURE_DRAFT: '重构文案',
  EXPAND_DRAFT: '扩写文案',
  SHORTEN_DRAFT: '压缩文案',
  REVISE_SELECTION: '修改选区',
  ADAPT_PLATFORM: '适配平台',
} as const;

const messageTypeNames: Record<ProjectAgentMessageType, string> = {
  MESSAGE: '对话',
  CONFIRMATION: '待确认',
  RUN_STATUS: '任务状态',
  ARTIFACT: '候选产物',
  SYSTEM_EVENT: '项目记录',
};

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function artifactHeading(artifact: ProjectArtifact) {
  const title = artifact.payload.title;
  if (typeof title === 'string' && title.trim()) return title;
  const options = strings(artifact.payload.titleOptions);
  if (options[0]) return options[0];
  return artifact.type === 'RESEARCH_PLAN' ? '研究计划' : artifact.type === 'RESEARCH_SOURCES' ? '研究来源' : artifact.type === 'RESEARCH_VERIFICATION' ? '事实核验结论' : artifact.type === 'OUTLINE' ? '文案大纲' : '文案候选';
}

export function ProjectAgent({ projectId, stage, platform, selectedMaterials, selection, blockedReason, refreshToken = 0, onClearSelection, onContextChange, onArtifactOpen, onArtifactAccepted, onOpenSettings }: ProjectAgentProps) {
  const [history, setHistory] = useState<ProjectAgentHistory>('CURRENT');
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'idle' | 'loading' | 'preparing' | 'confirming' | 'cancelling' | 'accepting'>('loading');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ProjectArtifact | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedCount = (selectedMaterials?.inputIds.length ?? 0) + (selectedMaterials?.referenceIds.length ?? 0);

  const reload = async (showLoading = false) => {
    if (showLoading) setBusy('loading');
    const result = await webCreative.agentContext(projectId, { stage, platform, history });
    setContext(result); onContextChange?.(result);
    if (showLoading) setBusy('idle');
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    setBusy('loading'); setError(''); setContext(null); setPreview(null);
    webCreative.agentContext(projectId, { stage, platform, history })
      .then((result) => { if (!cancelled) { setContext(result); onContextChange?.(result); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取 Agent 上下文失败。'); })
      .finally(() => { if (!cancelled) setBusy('idle'); });
    return () => { cancelled = true; };
  }, [history, platform, projectId, refreshToken, stage]);

  useEffect(() => {
    const status = context?.activeRun?.status;
    if (status !== 'QUEUED' && status !== 'RUNNING') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await webCreative.agentContext(projectId, { stage, platform, history });
        if (!cancelled) { setContext(result); onContextChange?.(result); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Agent 状态更新失败。');
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 1_500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [context?.activeRun?.status, history, platform, projectId, stage]);

  const activeRun = context?.activeRun;
  const runIsActive = Boolean(activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(activeRun.status));
  const canPrepare = canPrepareAgentRequest({ request, blockedReason, busy, runIsActive });

  const prepare = async (nextRequest = request) => {
    const normalizedRequest = nextRequest.trim();
    if (!canPrepareAgentRequest({ request: normalizedRequest, blockedReason, busy, runIsActive })) return;
    setBusy('preparing'); setError('');
    try {
      await webCreative.prepareAgent(projectId, {
        stage,
        ...(platform ? { platform } : {}),
        request: normalizedRequest,
        ...(selection ? { selection } : {}),
        inputIds: selectedMaterials?.inputIds ?? [],
        referenceIds: selectedMaterials?.referenceIds ?? [],
      });
      setRequest('');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent 任务准备失败。'); }
    finally { setBusy('idle'); }
  };

  const confirm = async () => {
    if (!activeRun || activeRun.status !== 'DRAFT') return;
    setBusy('confirming'); setError('');
    try {
      if (activeRun.action === 'PROJECT_RESEARCH_SOURCES') await webCreative.confirmResearchSources(activeRun.id);
      else if (activeRun.action === 'SOURCE_VERIFICATION') await webCreative.confirmSourceVerification(activeRun.id);
      else await webCreative.confirmAgentRun(activeRun.id);
      await reload();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent 任务启动失败。'); }
    finally { setBusy('idle'); }
  };

  const cancel = async () => {
    if (!activeRun || !['DRAFT', 'QUEUED'].includes(activeRun.status)) return;
    setBusy('cancelling'); setError('');
    try {
      if (activeRun.action === 'PROJECT_RESEARCH_SOURCES') await webCreative.cancelResearchSources(activeRun.id);
      else if (activeRun.action === 'SOURCE_VERIFICATION') await webCreative.cancelSourceVerification(activeRun.id);
      else await webCreative.cancelAgentRun(activeRun.id);
      await reload();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消失败。'); }
    finally { setBusy('idle'); }
  };

  const openArtifact = (artifact: ProjectArtifact) => {
    if (onArtifactOpen) { onArtifactOpen(artifact); return; }
    setPreview(artifact);
    setSelectedTitle(strings(artifact.payload.titleOptions)[0] ?? '');
  };

  const acceptArtifact = async () => {
    if (!preview || preview.status !== 'CANDIDATE' || !['OUTLINE', 'PLATFORM_COPY'].includes(preview.type)) return;
    setBusy('accepting'); setError('');
    try {
      const result = await webCreative.acceptArtifact(preview.id, preview.type === 'OUTLINE' ? selectedTitle : undefined);
      onArtifactAccepted(result.artifact, result.project);
      setPreview(result.artifact);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '采用候选失败。'); }
    finally { setBusy('idle'); }
  };

  const prepareResearchSources = async (artifactId: string) => {
    if (busy !== 'idle' || runIsActive) return;
    setBusy('preparing'); setError('');
    try {
      await webCreative.prepareResearchSources(projectId, artifactId);
      setPreview(null);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '来源任务准备失败。'); }
    finally { setBusy('idle'); }
  };

  const prepareSourceVerification = async (artifactId: string, selectedSourceIds: string[]) => {
    if (busy !== 'idle' || runIsActive || !selectedSourceIds.length) return;
    setBusy('preparing'); setError('');
    try {
      await webCreative.prepareSourceVerification(projectId, artifactId, selectedSourceIds);
      setPreview(null);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '事实核验准备失败。'); }
    finally { setBusy('idle'); }
  };

  const acceptSourceVerification = async () => {
    if (!preview || preview.type !== 'RESEARCH_VERIFICATION' || preview.status !== 'CANDIDATE') return;
    setBusy('accepting'); setError('');
    try {
      const result = await webCreative.acceptSourceVerification(preview.id);
      onArtifactAccepted(result.artifact);
      setPreview(result.artifact);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '研究结论确认失败。'); }
    finally { setBusy('idle'); }
  };

  const artifactById = useMemo(() => new Map((context?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [context?.artifacts]);
  const threadMessages = useMemo(() => messagesForAgentThread(context?.messages ?? []), [context?.messages]);
  const stageLabel = stage === 'RESEARCH' ? '研究' : `文案${platform ? ` · ${platformName[platform]}` : ''}`;
  const followKey = `${threadMessages.at(-1)?.id ?? ''}:${context?.activeRun?.id ?? ''}:${context?.activeRun?.status ?? ''}:${context?.artifacts[0]?.id ?? ''}`;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followKey]);

  return <aside className="project-agent" aria-label="项目 Agent">
    <header className="project-agent-head">
      <div><Bot size={19}/><div><h2>项目 Agent</h2><span>{stageLabel}</span></div></div>
      <div className="project-agent-history" aria-label="Agent 历史范围">
        <button type="button" className={history === 'CURRENT' ? 'active' : ''} onClick={() => setHistory('CURRENT')}>当前阶段</button>
        <button type="button" className={history === 'ALL' ? 'active' : ''} onClick={() => setHistory('ALL')}>完整历史</button>
      </div>
    </header>
    <div ref={threadRef} className="project-agent-thread">
      {busy === 'loading' && <div className="project-agent-skeleton" aria-label="正在读取 Agent 上下文"><i/><i/><i/></div>}
      {busy !== 'loading' && !threadMessages.length && <div className="project-agent-empty"><FileCheck2 size={22}/><b>还没有对话</b></div>}
      {(context?.summaries.length ?? 0) > 0 && <div className="project-agent-summary">已继承 {context?.summaries.length} 条前序摘要</div>}
      {threadMessages.map((message) => {
        const refs = (message.artifactRefs ?? []).map((id) => artifactById.get(id)).filter((item): item is ProjectArtifact => Boolean(item));
        const messageLabel = refs.some((artifact) => artifact.type === 'RESEARCH_VERIFICATION') ? '核验结论' : refs.some((artifact) => artifact.type === 'RESEARCH_SOURCES') ? '来源结果' : refs.some((artifact) => artifact.type === 'RESEARCH_PLAN') ? '研究计划' : messageTypeNames[message.messageType ?? 'MESSAGE'];
        return <article key={message.id} className={`project-agent-message ${message.role.toLowerCase()} type-${(message.messageType ?? 'MESSAGE').toLowerCase()}`}>
          <span>{message.role === 'USER' ? '你' : messageLabel}</span>
          <p>{message.content}</p>
          {refs.map((artifact) => <button key={artifact.id} className="artifact-link" type="button" onClick={() => openArtifact(artifact)}><Eye size={14}/>{artifact.type === 'RESEARCH_PLAN' ? '查看计划' : artifact.type === 'RESEARCH_SOURCES' ? '查看来源' : artifact.type === 'RESEARCH_VERIFICATION' ? '查看核验' : '查看候选'}</button>)}
        </article>;
      })}
      {activeRun?.status === 'DRAFT' && <section className="agent-confirmation">
        <header><b>{actionNames[activeRun.action]}</b><span>待确认</span></header>
        {activeRun.action === 'PROJECT_RESEARCH_SOURCES' ? <dl className="source-confirmation-grid">
          <div><dt>网页搜索</dt><dd>搜索 {activeRun.confirmation.sourceCounts?.search ?? 0} 次</dd></div>
          <div><dt>链接读取</dt><dd>读取 {activeRun.confirmation.sourceCounts?.read ?? 0} 个</dd></div>
          <div><dt>人工补充</dt><dd>补充 {activeRun.confirmation.sourceCounts?.askUser ?? 0} 项</dd></div>
          <div className="wide"><dt>工具</dt><dd>{activeRun.confirmation.tools?.join('、') || '无外部工具'}</dd></div>
          <div className="wide"><dt>写入范围</dt><dd>{activeRun.confirmation.writeScope}</dd></div>
        </dl> : <dl>
          <div><dt>模型</dt><dd>{activeRun.confirmation.model}</dd></div>
          <div><dt>提示词</dt><dd>{activeRun.confirmation.promptVersion ?? '内置'}</dd></div>
          <div><dt>资料</dt><dd>{activeRun.confirmation.materialCount} 条</dd></div>
          <div><dt>Skill</dt><dd>{activeRun.confirmation.skillNames.join('、') || '无'}</dd></div>
          <div className="wide"><dt>写入范围</dt><dd>{activeRun.confirmation.writeScope}</dd></div>
        </dl>}
        <footer><button className="icon-button" type="button" aria-label="取消任务" disabled={busy !== 'idle'} onClick={() => void cancel()}><X size={16}/></button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void confirm()}>{busy === 'confirming' ? <LoaderCircle size={15}/> : <Check size={15}/>}确认{activeRun.action === 'PROJECT_RESEARCH_SOURCES' ? '执行' : '调用'}</button></footer>
      </section>}
      {activeRun && ['QUEUED', 'RUNNING'].includes(activeRun.status) && <div className="agent-running" aria-live="polite"><LoaderCircle size={18}/><b>{activeRun.status === 'QUEUED' ? '等待执行' : activeRun.action === 'PROJECT_RESEARCH_SOURCES' ? '正在查找来源' : activeRun.action === 'SOURCE_VERIFICATION' ? '正在核验事实' : '正在生成候选'}</b>{activeRun.status === 'QUEUED' && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>{busy === 'cancelling' ? '取消中' : '取消'}</button>}</div>}
      {activeRun?.status === 'FAILED' && <div className="agent-run-error"><CircleAlert size={17}/><div><b>执行失败</b><p>{activeRun.error}</p></div></div>}
    </div>
    {error && <div className="project-agent-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/(模型|提示词|核心 Agent|Key)/.test(error) && <button className="text-button" type="button" onClick={() => onOpenSettings(/Tavily|检索 API/.test(error) ? 'search' : /核心 Agent/.test(error) ? 'agent' : 'policies')}><Settings2 size={14}/>去配置</button>}</div>}
    <div className="project-agent-composer">
      <div><span>{stage === 'RESEARCH' ? selectedCount ? `已选 ${selectedCount} 条资料` : '未选资料' : selection ? `已选择 ${selection.text.length} 字` : '自由对话'}</span>{stage === 'RESEARCH' && !runIsActive && !blockedReason && <button className="project-agent-quick-action" type="button" disabled={busy !== 'idle'} onClick={() => void prepare(researchQuickAction.request)}>{researchQuickAction.label}</button>}{selection && onClearSelection && <button className="selection-clear" type="button" aria-label="清除正文选区" onClick={onClearSelection}><X size={13}/></button>}{blockedReason && <em>{blockedReason}</em>}</div>
      <textarea rows={3} value={request} maxLength={2_000} placeholder={stage === 'RESEARCH' ? '说明要核验的问题，或直接制定研究计划' : '例如：保留事实，把这篇文章润色得更自然'} onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void prepare(); }}/>
      <button className="button primary" type="button" title="准备 Agent 任务" disabled={!canPrepare} onClick={() => void prepare()}>{busy === 'preparing' ? <LoaderCircle size={16}/> : <Send size={16}/>}发送</button>
    </div>
    {preview && <ArtifactPreview artifact={preview} selectedTitle={selectedTitle} onTitle={setSelectedTitle} busy={busy !== 'idle'} onAccept={() => void acceptArtifact()} onAcceptVerification={() => void acceptSourceVerification()} onPrepareSources={(artifactId) => void prepareResearchSources(artifactId)} onPrepareVerification={(artifactId, sourceIds) => void prepareSourceVerification(artifactId, sourceIds)} onClose={() => setPreview(null)}/>}
  </aside>;
}

function ArtifactPreview({ artifact, selectedTitle, onTitle, busy, onAccept, onAcceptVerification, onPrepareSources, onPrepareVerification, onClose }: { artifact: ProjectArtifact; selectedTitle: string; onTitle: (value: string) => void; busy: boolean; onAccept: () => void; onAcceptVerification: () => void; onPrepareSources: (artifactId: string) => void; onPrepareVerification: (artifactId: string, sourceIds: string[]) => void; onClose: () => void }) {
  const titleOptions = strings(artifact.payload.titleOptions);
  const facts = strings(artifact.payload.factsToVerify);
  const body = typeof artifact.payload.body === 'string' ? artifact.payload.body : '';
  const summary = typeof artifact.payload.summary === 'string' ? artifact.payload.summary : typeof artifact.payload.changeSummary === 'string' ? artifact.payload.changeSummary : '';
  const researchQuestions = objectItems(artifact.payload.questions, 'question');
  const researchClaims = artifact.type === 'RESEARCH_PLAN' ? objectItems(artifact.payload.claims, 'claim') : [];
  const researchActions = objectItems(artifact.payload.nextActions, 'purpose');
  const researchSources = objectItems(artifact.payload.sources, 'title');
  const verificationClaims = artifact.type === 'RESEARCH_VERIFICATION' ? objectItems(artifact.payload.claims, 'claim') : [];
  const sourceNotice = typeof artifact.payload.notice === 'string' ? artifact.payload.notice : '';
  const canAccept = artifact.status === 'CANDIDATE' && ['OUTLINE', 'PLATFORM_COPY'].includes(artifact.type);
  const sourceValues = researchSources.map((item) => item.value);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => initialSourceSelection(sourceValues));
  const capturedSourceIds = allCapturedSourceIds(sourceValues);
  return <div className="agent-artifact-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="agent-artifact-preview" role="dialog" aria-modal="true" aria-labelledby="agent-artifact-title">
      <header><div><span>{artifact.platform ? platformName[artifact.platform] : '项目'}</span><h2 id="agent-artifact-title">{artifactHeading(artifact)}</h2></div><button className="icon-button" type="button" aria-label="关闭候选" onClick={onClose}><X size={18}/></button></header>
      <div className="agent-artifact-body">
        {titleOptions.length > 0 && <label><span>标题方案</span><select value={selectedTitle} onChange={(event) => onTitle(event.target.value)}>{titleOptions.map((title) => <option key={title}>{title}</option>)}</select></label>}
        {summary && <p className="artifact-summary">{summary}</p>}
        {researchQuestions.length > 0 && <div className="research-plan-block"><b>待回答问题</b><ol>{researchQuestions.map((item) => <li key={item.text}><span>{item.text}</span>{strings(item.value.preferredSources).length > 0 && <small>{strings(item.value.preferredSources).join('、')}</small>}</li>)}</ol></div>}
        {researchClaims.length > 0 && <div className="research-plan-block"><b>待核验主张</b><ul>{researchClaims.map((item) => <li key={item.text}><span className={`priority-${String(item.value.priority ?? 'MEDIUM').toLowerCase()}`}>{priorityName(item.value.priority)}</span>{item.text}</li>)}</ul></div>}
        {researchActions.length > 0 && <div className="research-plan-actions"><b>下一步</b>{researchActions.map((item) => <div key={`${String(item.value.action)}-${item.text}`}><span>{actionName(item.value.action)}</span><p>{item.text}</p>{typeof item.value.target === 'string' && <small>{item.value.target}</small>}</div>)}</div>}
        {sourceNotice && <div className="research-source-notice"><CircleAlert size={15}/><span>{sourceNotice}</span></div>}
        {researchSources.length > 0 && <div className="research-source-selection"><div className="research-source-toolbar"><b>选择核验来源</b><span>{selectedSourceIds.length} / {capturedSourceIds.length}</span><button type="button" onClick={() => setSelectedSourceIds(capturedSourceIds)}>全选</button><button type="button" onClick={() => setSelectedSourceIds([])}>清空</button></div><div className="research-source-list">{researchSources.map((item) => {
          const status = String(item.value.status ?? 'FAILED');
          const url = typeof item.value.url === 'string' ? item.value.url : '';
          const id = String(item.value.id ?? '');
          const metadata = item.value.metadata && typeof item.value.metadata === 'object' ? item.value.metadata as Record<string, unknown> : {};
          return <article key={id || `${status}-${item.text}`} className={`research-source-row status-${status.toLowerCase()} ${selectedSourceIds.includes(id) ? 'selected' : ''}`}>
            <header><input type="checkbox" aria-label={`选择来源：${item.text}`} checked={selectedSourceIds.includes(id)} disabled={status !== 'CAPTURED'} onChange={() => setSelectedSourceIds(toggleSourceSelection(selectedSourceIds, sourceValues, id))}/><span>{sourceStatusName(status)}</span><b>{item.text}</b>{url && <a href={url} target="_blank" rel="noreferrer" aria-label={`打开来源：${item.text}`}><ExternalLink size={14}/></a>}</header>
            <small>{String(item.value.source ?? '')}<i>{sourceTypeName(metadata.sourceType)}</i><i>{languageName(metadata.language)}</i>{typeof metadata.relevanceScore === 'number' && <i>相关 {Math.round(metadata.relevanceScore * 100)}%</i>}{metadata.publishedAt ? <i>{new Date(String(metadata.publishedAt)).toLocaleDateString('zh-CN')}</i> : null}</small>
            {typeof item.value.summary === 'string' && item.value.summary && <p>{item.value.summary}</p>}
            {typeof item.value.error === 'string' && item.value.error && <p className="source-error">{item.value.error}</p>}
          </article>;
        })}</div></div>}
        {verificationClaims.length > 0 && <div className="verification-claim-list">{verificationClaims.map((item) => {
          const status = String(item.value.status ?? 'NEEDS_REVIEW');
          const evidence = objectItems(item.value.evidence, 'quote');
          return <article key={item.text} className={`verification-claim status-${status.toLowerCase()}`}><header><span>{verificationStatusName(status)}</span><b>{item.text}</b></header><p>{String(item.value.explanation ?? '')}</p>{evidence.length > 0 && <div>{evidence.map((entry) => <a key={`${String(entry.value.sourceId)}-${entry.text}`} href={String(entry.value.url)} target="_blank" rel="noreferrer"><span>{entry.value.relation === 'CONFLICTS' ? '冲突' : '支持'}</span><q>{entry.text}</q><small>{String(entry.value.source ?? entry.value.title ?? '')}</small></a>)}</div>}</article>;
        })}</div>}
        {body && <div className="artifact-copy"><h3>{artifactHeading(artifact)}</h3><p>{body}</p></div>}
        {facts.length > 0 && <div className="artifact-facts"><b>待核验</b><ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>}
      </div>
      <footer><button className="button" type="button" disabled={busy} onClick={onClose}>关闭</button>{artifact.type === 'RESEARCH_PLAN' && <button className="button primary" type="button" disabled={busy} onClick={() => onPrepareSources(artifact.id)}>{busy ? <LoaderCircle size={16}/> : <Search size={16}/>}准备查找资料</button>}{artifact.type === 'RESEARCH_SOURCES' && <button className="button primary" type="button" disabled={busy || selectedSourceIds.length === 0} onClick={() => onPrepareVerification(artifact.id, selectedSourceIds)}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}准备事实核验</button>}{artifact.type === 'RESEARCH_VERIFICATION' && artifact.status === 'CANDIDATE' && <button className="button primary" type="button" disabled={busy} onClick={onAcceptVerification}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}确认研究结论</button>}{canAccept && <button className="button primary" type="button" disabled={busy || (artifact.type === 'OUTLINE' && !selectedTitle)} onClick={onAccept}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}采用为当前版本</button>}</footer>
    </section>
  </div>;
}

function objectItems(value: unknown, textKey: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const text = record[textKey];
    return typeof text === 'string' && text.trim() ? [{ text, value: record }] : [];
  });
}

function priorityName(value: unknown) {
  return value === 'HIGH' ? '高' : value === 'LOW' ? '低' : '中';
}

function actionName(value: unknown) {
  return value === 'SEARCH_WEB' ? '网络搜索' : value === 'READ_LINK' ? '读取链接' : '补充资料';
}

function sourceStatusName(value: string) {
  return value === 'CAPTURED' ? '已保存' : value === 'NEEDS_USER' ? '需补充' : '失败';
}

function sourceTypeName(value: unknown) {
  return value === 'OFFICIAL' ? '官方' : value === 'NEWS' ? '媒体' : value === 'PUBLISHING' ? '内容平台' : value === 'USER' ? '用户补充' : '网页';
}

function languageName(value: unknown) {
  return value === 'EN' ? '英文' : '中文';
}

function verificationStatusName(value: string) {
  return value === 'VERIFIED' ? '多源通过' : value === 'SINGLE_SOURCE' ? '单一来源' : value === 'CONFLICTING' ? '存在冲突' : '待复核';
}
