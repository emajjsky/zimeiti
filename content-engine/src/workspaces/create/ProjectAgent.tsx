import { Bot, Check, CircleAlert, Eye, FileCheck2, LoaderCircle, Send, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { canPrepareAgentRequest, messagesForAgentThread, researchQuickAction } from '../../domain/project-agent-composer.mjs';
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
  onOpenSettings: (target: 'agent' | 'policies') => void;
};

const actionNames = {
  PROJECT_RESEARCH_PLAN: '生成研究计划',
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
  return artifact.type === 'RESEARCH_PLAN' ? '研究计划' : artifact.type === 'OUTLINE' ? '文案大纲' : '文案候选';
}

export function ProjectAgent({ projectId, stage, platform, selectedMaterials, selection, blockedReason, refreshToken = 0, onClearSelection, onContextChange, onArtifactOpen, onArtifactAccepted, onOpenSettings }: ProjectAgentProps) {
  const [history, setHistory] = useState<ProjectAgentHistory>('CURRENT');
  const [context, setContext] = useState<ProjectAgentContext | null>(null);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'idle' | 'loading' | 'preparing' | 'confirming' | 'cancelling' | 'accepting'>('loading');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ProjectArtifact | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');
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
    try { await webCreative.confirmAgentRun(activeRun.id); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent 任务启动失败。'); }
    finally { setBusy('idle'); }
  };

  const cancel = async () => {
    if (!activeRun || !['DRAFT', 'QUEUED'].includes(activeRun.status)) return;
    setBusy('cancelling'); setError('');
    try { await webCreative.cancelAgentRun(activeRun.id); await reload(); }
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

  const artifactById = useMemo(() => new Map((context?.artifacts ?? []).map((artifact) => [artifact.id, artifact])), [context?.artifacts]);
  const threadMessages = useMemo(() => messagesForAgentThread(context?.messages ?? []), [context?.messages]);
  const stageLabel = stage === 'RESEARCH' ? '研究' : `文案${platform ? ` · ${platformName[platform]}` : ''}`;

  return <aside className="project-agent" aria-label="项目 Agent">
    <header className="project-agent-head">
      <div><Bot size={19}/><div><h2>项目 Agent</h2><span>{stageLabel}</span></div></div>
      <div className="project-agent-history" aria-label="Agent 历史范围">
        <button type="button" className={history === 'CURRENT' ? 'active' : ''} onClick={() => setHistory('CURRENT')}>当前阶段</button>
        <button type="button" className={history === 'ALL' ? 'active' : ''} onClick={() => setHistory('ALL')}>完整历史</button>
      </div>
    </header>
    <div className="project-agent-thread">
      {busy === 'loading' && <div className="project-agent-skeleton" aria-label="正在读取 Agent 上下文"><i/><i/><i/></div>}
      {busy !== 'loading' && !threadMessages.length && <div className="project-agent-empty"><FileCheck2 size={22}/><b>还没有对话</b></div>}
      {(context?.summaries.length ?? 0) > 0 && <div className="project-agent-summary">已继承 {context?.summaries.length} 条前序摘要</div>}
      {threadMessages.map((message) => {
        const refs = (message.artifactRefs ?? []).map((id) => artifactById.get(id)).filter((item): item is ProjectArtifact => Boolean(item));
        return <article key={message.id} className={`project-agent-message ${message.role.toLowerCase()} type-${(message.messageType ?? 'MESSAGE').toLowerCase()}`}>
          <span>{message.role === 'USER' ? '你' : messageTypeNames[message.messageType ?? 'MESSAGE']}</span>
          <p>{message.content}</p>
          {refs.map((artifact) => <button key={artifact.id} className="artifact-link" type="button" onClick={() => openArtifact(artifact)}><Eye size={14}/>{artifact.type === 'RESEARCH_PLAN' ? '查看计划' : '查看候选'}</button>)}
        </article>;
      })}
      {activeRun?.status === 'DRAFT' && <section className="agent-confirmation">
        <header><b>{actionNames[activeRun.action]}</b><span>待确认</span></header>
        <dl>
          <div><dt>模型</dt><dd>{activeRun.confirmation.model}</dd></div>
          <div><dt>提示词</dt><dd>{activeRun.confirmation.promptVersion ?? '内置'}</dd></div>
          <div><dt>资料</dt><dd>{activeRun.confirmation.materialCount} 条</dd></div>
          <div><dt>Skill</dt><dd>{activeRun.confirmation.skillNames.join('、') || '无'}</dd></div>
          <div className="wide"><dt>写入范围</dt><dd>{activeRun.confirmation.writeScope}</dd></div>
        </dl>
        <footer><button className="icon-button" type="button" aria-label="取消任务" disabled={busy !== 'idle'} onClick={() => void cancel()}><X size={16}/></button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void confirm()}>{busy === 'confirming' ? <LoaderCircle size={15}/> : <Check size={15}/>}确认调用</button></footer>
      </section>}
      {activeRun && ['QUEUED', 'RUNNING'].includes(activeRun.status) && <div className="agent-running" aria-live="polite"><LoaderCircle size={18}/><b>{activeRun.status === 'QUEUED' ? '等待执行' : '正在生成候选'}</b>{activeRun.status === 'QUEUED' && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>{busy === 'cancelling' ? '取消中' : '取消'}</button>}</div>}
      {activeRun?.status === 'FAILED' && <div className="agent-run-error"><CircleAlert size={17}/><div><b>执行失败</b><p>{activeRun.error}</p></div></div>}
    </div>
    {error && <div className="project-agent-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/(模型|提示词|核心 Agent|Key)/.test(error) && <button className="text-button" type="button" onClick={() => onOpenSettings(/核心 Agent/.test(error) ? 'agent' : 'policies')}><Settings2 size={14}/>去配置</button>}</div>}
    <div className="project-agent-composer">
      <div><span>{stage === 'RESEARCH' ? selectedCount ? `已选 ${selectedCount} 条资料` : '未选资料' : selection ? `已选择 ${selection.text.length} 字` : '自由对话'}</span>{stage === 'RESEARCH' && !runIsActive && !blockedReason && <button className="project-agent-quick-action" type="button" disabled={busy !== 'idle'} onClick={() => void prepare(researchQuickAction.request)}>{researchQuickAction.label}</button>}{selection && onClearSelection && <button className="selection-clear" type="button" aria-label="清除正文选区" onClick={onClearSelection}><X size={13}/></button>}{blockedReason && <em>{blockedReason}</em>}</div>
      <textarea rows={3} value={request} maxLength={2_000} placeholder={stage === 'RESEARCH' ? '说明要核验的问题，或直接制定研究计划' : '例如：保留事实，把这篇文章润色得更自然'} onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void prepare(); }}/>
      <button className="button primary" type="button" title="准备 Agent 任务" disabled={!canPrepare} onClick={() => void prepare()}>{busy === 'preparing' ? <LoaderCircle size={16}/> : <Send size={16}/>}发送</button>
    </div>
    {preview && <ArtifactPreview artifact={preview} selectedTitle={selectedTitle} onTitle={setSelectedTitle} busy={busy === 'accepting'} onAccept={() => void acceptArtifact()} onClose={() => setPreview(null)}/>} 
  </aside>;
}

function ArtifactPreview({ artifact, selectedTitle, onTitle, busy, onAccept, onClose }: { artifact: ProjectArtifact; selectedTitle: string; onTitle: (value: string) => void; busy: boolean; onAccept: () => void; onClose: () => void }) {
  const titleOptions = strings(artifact.payload.titleOptions);
  const facts = strings(artifact.payload.factsToVerify);
  const body = typeof artifact.payload.body === 'string' ? artifact.payload.body : '';
  const summary = typeof artifact.payload.summary === 'string' ? artifact.payload.summary : typeof artifact.payload.changeSummary === 'string' ? artifact.payload.changeSummary : '';
  const researchQuestions = objectItems(artifact.payload.questions, 'question');
  const researchClaims = objectItems(artifact.payload.claims, 'claim');
  const researchActions = objectItems(artifact.payload.nextActions, 'purpose');
  const canAccept = artifact.status === 'CANDIDATE' && ['OUTLINE', 'PLATFORM_COPY'].includes(artifact.type);
  return <div className="agent-artifact-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="agent-artifact-preview" role="dialog" aria-modal="true" aria-labelledby="agent-artifact-title">
      <header><div><span>{artifact.platform ? platformName[artifact.platform] : '项目'}</span><h2 id="agent-artifact-title">{artifactHeading(artifact)}</h2></div><button className="icon-button" type="button" aria-label="关闭候选" onClick={onClose}><X size={18}/></button></header>
      <div className="agent-artifact-body">
        {titleOptions.length > 0 && <label><span>标题方案</span><select value={selectedTitle} onChange={(event) => onTitle(event.target.value)}>{titleOptions.map((title) => <option key={title}>{title}</option>)}</select></label>}
        {summary && <p className="artifact-summary">{summary}</p>}
        {researchQuestions.length > 0 && <div className="research-plan-block"><b>待回答问题</b><ol>{researchQuestions.map((item) => <li key={item.text}><span>{item.text}</span>{strings(item.value.preferredSources).length > 0 && <small>{strings(item.value.preferredSources).join('、')}</small>}</li>)}</ol></div>}
        {researchClaims.length > 0 && <div className="research-plan-block"><b>待核验主张</b><ul>{researchClaims.map((item) => <li key={item.text}><span className={`priority-${String(item.value.priority ?? 'MEDIUM').toLowerCase()}`}>{priorityName(item.value.priority)}</span>{item.text}</li>)}</ul></div>}
        {researchActions.length > 0 && <div className="research-plan-actions"><b>下一步</b>{researchActions.map((item) => <div key={`${String(item.value.action)}-${item.text}`}><span>{actionName(item.value.action)}</span><p>{item.text}</p>{typeof item.value.target === 'string' && <small>{item.value.target}</small>}</div>)}</div>}
        {body && <div className="artifact-copy"><h3>{artifactHeading(artifact)}</h3><p>{body}</p></div>}
        {facts.length > 0 && <div className="artifact-facts"><b>待核验</b><ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>}
      </div>
      <footer><button className="button" type="button" disabled={busy} onClick={onClose}>关闭</button>{canAccept && <button className="button primary" type="button" disabled={busy || (artifact.type === 'OUTLINE' && !selectedTitle)} onClick={onAccept}>{busy ? <LoaderCircle size={16}/> : <Check size={16}/>}采用为当前版本</button>}</footer>
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
