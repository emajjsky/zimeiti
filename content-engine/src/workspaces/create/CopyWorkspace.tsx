import { CircleAlert, History, LoaderCircle, PenLine, Save, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative, webDrafts } from '../../data/webApi';
import type { ContentProject } from '../../domain/content';
import type { ContentDraft } from '../../domain/content-drafts';
import { normalizeWritingLengthTarget, writingLengthTargetOptions, type AccountVoiceProfile, type CreativeSkillDefinition, type CreativeSkillDimension, type ProjectAgentContext, type ProjectArtifact, type VoiceOffset, type WritingBriefInput } from '../../domain/creative';
import { CopyCandidateDialog } from './CopyCandidateDialog';
import { ProjectAgent } from './ProjectAgent';

const sharedDimensions: { id: 'SUBJECT' | 'CONTENT_TYPE'; label: string }[] = [
  { id: 'SUBJECT', label: '题材' },
  { id: 'CONTENT_TYPE', label: '内容类型' },
];
const voiceOffsets: { id: VoiceOffset; label: string }[] = [
  { id: 'DEFAULT', label: '默认' },
  { id: 'MORE_RESTRAINED', label: '更克制' },
  { id: 'SHARPER', label: '更锋利' },
  { id: 'MORE_PERSONAL', label: '更个人化' },
  { id: 'MORE_NARRATIVE', label: '更叙述' },
];

function artifactTitle(artifact: ProjectArtifact) {
  if (typeof artifact.payload.title === 'string' && artifact.payload.title.trim()) return artifact.payload.title;
  const options = Array.isArray(artifact.payload.titleOptions) ? artifact.payload.titleOptions.filter((item): item is string => typeof item === 'string') : [];
  return options[0] ?? (artifact.type === 'OUTLINE' ? '文案大纲' : '文案候选');
}

function artifactStatus(status: ProjectArtifact['status']) {
  return status === 'ACCEPTED' ? '已采用' : status === 'REJECTED' ? '已废弃' : '待处理';
}

export function CopyWorkspace({ project, draft, brief, briefState, skills, accountVoices, onProjectChange, onDraftChange, onReloadDraft, onSaveBrief, onContinue, onOpenModelSettings, onOpenAgentSettings, onOpenVoiceSettings }: {
  project: ContentProject;
  draft: ContentDraft;
  brief: WritingBriefInput | null;
  briefState: 'loading' | 'saving' | 'saved' | 'error';
  skills: CreativeSkillDefinition[];
  accountVoices: AccountVoiceProfile[];
  onProjectChange: (project: ContentProject) => void;
  onDraftChange: (draft: ContentDraft) => void;
  onReloadDraft: () => Promise<ContentDraft>;
  onSaveBrief: (next: WritingBriefInput) => Promise<void>;
  onContinue: () => void;
  onOpenModelSettings: () => void;
  onOpenAgentSettings: () => void;
  onOpenVoiceSettings: () => void;
}) {
  const [content, setContent] = useState({ title: draft.title, body: draft.body });
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [strategy, setStrategy] = useState<WritingBriefInput | null>(brief);
  const [strategyState, setStrategyState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [selection, setSelection] = useState<{ text: string; start: number; end: number }>();
  const [agentContext, setAgentContext] = useState<ProjectAgentContext | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [candidate, setCandidate] = useState<ProjectArtifact | null>(null);
  const [candidateBusy, setCandidateBusy] = useState<'idle' | 'accepting' | 'rejecting'>('idle');
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState('');
  const [completionBusy, setCompletionBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const contentRef = useRef(content);
  const saveQueue = useRef<Promise<ContentDraft>>(Promise.resolve(draft));

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => {
    setContent({ title: draft.title, body: draft.body });
    setSaveState('saved'); setSelection(undefined); setCandidate(null); setHistoryOpen(false); setError('');
  }, [draft.id]);
  useEffect(() => {
    setStrategy(brief);
    setStrategyState(briefState === 'error' ? 'error' : briefState === 'saving' || briefState === 'loading' ? 'saving' : 'saved');
  }, [brief, briefState]);
  useEffect(() => {
    const resize = (element: HTMLTextAreaElement | null, minimum: number) => {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.max(minimum, element.scrollHeight)}px`;
    };
    resize(titleRef.current, 54); resize(bodyRef.current, 420);
  }, [content.body, content.title]);

  const persistDraft = (snapshot = contentRef.current) => {
    setSaveState('saving'); setError('');
    const queued = saveQueue.current.catch(() => draftRef.current).then(async () => {
      const saved = await webDrafts.patch(draftRef.current.id, {
        revision: draftRef.current.revision,
        title: snapshot.title.trim() || '未命名草稿',
        body: snapshot.body,
      });
      draftRef.current = saved;
      onDraftChange(saved);
      if (contentRef.current.title === snapshot.title && contentRef.current.body === snapshot.body) setSaveState('saved');
      return saved;
    }).catch((reason) => {
      setSaveState('error'); setError(reason instanceof Error ? reason.message : '公众号正文保存失败。');
      throw reason;
    });
    saveQueue.current = queued;
    return queued;
  };

  const replaceDraftTitle = async (title: string) => {
    const snapshot = { ...contentRef.current, title };
    contentRef.current = snapshot;
    setContent(snapshot);
    setSaveState('dirty');
    await persistDraft(snapshot);
  };

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const snapshot = content;
    const timer = window.setTimeout(() => { void persistDraft(snapshot).catch(() => undefined); }, 700);
    return () => window.clearTimeout(timer);
  }, [content, saveState]);

  const skillGroups = useMemo(() => new Map<CreativeSkillDimension, CreativeSkillDefinition[]>(sharedDimensions.map(({ id }) => [id, skills.filter((skill) => skill.dimension === id)])), [skills]);
  const artifacts = (agentContext?.artifacts ?? []).filter((artifact) => artifact.type === 'OUTLINE' || artifact.type === 'PLATFORM_COPY');
  const hasAcceptedCopy = content.body.trim().length >= 80
    || artifacts.some((artifact) => artifact.type === 'PLATFORM_COPY' && artifact.platform === 'WECHAT' && artifact.status === 'ACCEPTED');
  const platformStrategy = strategy?.platformSkills.WECHAT;
  const lengthTarget = normalizeWritingLengthTarget(platformStrategy?.lengthTarget ?? strategy?.lengthTarget);
  const activeVoice = accountVoices.find((voice) => voice.id === strategy?.accountVoiceProfileId);
  const copyRunActive = Boolean(agentContext?.activeRun && ['DRAFT', 'QUEUED', 'RUNNING'].includes(agentContext.activeRun.status));
  const copyActionBlockedReason = strategyState === 'saving' ? '正在保存创作设定'
    : strategyState === 'error' ? '创作设定保存失败，请重试'
      : saveState === 'dirty' || saveState === 'saving' ? '正在保存正文' : undefined;

  const applyServerDraft = (updated: ContentDraft) => {
    const nextContent = { title: updated.title, body: updated.body };
    draftRef.current = updated;
    contentRef.current = nextContent;
    saveQueue.current = Promise.resolve(updated);
    setContent(nextContent);
    setSaveState('saved');
    setSelection(undefined);
  };

  const changeContent = (patch: Partial<typeof content>) => {
    setContent((current) => ({ ...current, ...patch })); setSaveState('dirty'); setSelection(undefined);
  };
  const captureSelection = () => {
    const element = bodyRef.current;
    if (!element || element.selectionStart === element.selectionEnd) { setSelection(undefined); return; }
    setSelection({ text: element.value.slice(element.selectionStart, element.selectionEnd), start: element.selectionStart, end: element.selectionEnd });
  };
  const changeStrategy = (patch: Partial<WritingBriefInput>) => {
    setStrategy((current) => current ? { ...current, ...patch, selectedPlatforms: ['WECHAT'] } : current);
    setStrategyState('dirty'); setError('');
  };
  const saveStrategy = async () => {
    if (!strategy) return;
    setStrategyState('saving'); setError('');
    try { await onSaveBrief({ ...strategy, selectedPlatforms: ['WECHAT'] }); setStrategyState('saved'); }
    catch (reason) { setStrategyState('error'); setError(reason instanceof Error ? reason.message : '写作策略保存失败。'); }
  };
  useEffect(() => {
    if (strategyState !== 'dirty' || !strategy) return;
    const timer = window.setTimeout(() => { void saveStrategy(); }, 700);
    return () => window.clearTimeout(timer);
  }, [strategy, strategyState]);

  const acceptCandidate = async (selectedTitle?: string) => {
    if (!candidate) return;
    setCandidateBusy('accepting'); setError('');
    try {
      const result = await webCreative.acceptArtifact(candidate.id, selectedTitle);
      onProjectChange(result.project);
      const updated = await onReloadDraft();
      applyServerDraft(updated);
      setCandidate(null); setSaveState('saved'); setRefreshToken((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '采用候选失败。'); }
    finally { setCandidateBusy('idle'); }
  };
  const rejectCandidate = async () => {
    if (!candidate) return;
    setCandidateBusy('rejecting'); setError('');
    try { await webCreative.rejectArtifact(candidate.id); setCandidate(null); setRefreshToken((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '废弃候选失败。'); }
    finally { setCandidateBusy('idle'); }
  };
  const continueToVisual = async () => {
    if (content.body.trim().length < 80) { setError('公众号正文至少需要 80 个字，才能进入配图。'); return; }
    setCompletionBusy(true);
    try { await persistDraft(); onContinue(); }
    finally { setCompletionBusy(false); }
  };

  return <section className="copy-workspace">
    <header className="copy-platform-bar"><div className="copy-current-channel"><b>公众号正文</b><span>母稿</span></div><button className="button primary" type="button" disabled={completionBusy} onClick={() => void continueToVisual()}>{completionBusy ? <LoaderCircle size={16}/> : null}确认正文，开始配图</button></header>
    {strategy && <section className="copy-strategy" aria-labelledby="copy-strategy-title"><header><div><h2 id="copy-strategy-title">写作策略</h2><span>公众号母稿</span></div><div className={`copy-strategy-state ${strategyState}`}>{strategyState === 'saving' ? '正在保存创作设定' : strategyState === 'dirty' ? '准备自动保存' : strategyState === 'saved' ? '已自动保存' : <><span>保存失败</span><button className="text-button" type="button" onClick={() => void saveStrategy()}>重试保存</button></>}</div></header><div className="copy-strategy-fields">{sharedDimensions.map(({ id, label }) => <label key={id}><span>{label}</span><select value={strategy.selectedSkills[id]} onChange={(event) => changeStrategy({ selectedSkills: { ...strategy.selectedSkills, [id]: event.target.value } })}>{(skillGroups.get(id) ?? []).map((skill) => <option key={skill.version.id} value={skill.version.id}>{skill.name}</option>)}</select></label>)}<label><span>目标篇幅</span><select value={lengthTarget} onChange={(event) => changeStrategy({ lengthTarget: event.target.value, platformSkills: { ...strategy.platformSkills, WECHAT: { ...(platformStrategy ?? { LAYOUT: '', CHANNEL: '' }), lengthTarget: event.target.value } } })}>{writingLengthTargetOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label></div></section>}
    {error && <div className="copy-workspace-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/模型|提示词|任务策略/.test(error) && <button className="text-button" type="button" onClick={onOpenModelSettings}>去配置</button>}</div>}
    {strategy && <section className="copy-voice-state" aria-label="账号声音"><div className="copy-voice-summary"><span>当前账号声音</span><div><b>{activeVoice?.name ?? '尚未设置账号声音'}</b><p>{activeVoice?.rules.opening ?? '先在设置中导入自己的文章，提炼可继承的表达规则。'}</p></div></div><div className="copy-voice-controls"><label><span>使用声音</span><select value={strategy.accountVoiceProfileId} onChange={(event) => changeStrategy({ accountVoiceProfileId: event.target.value })}><option value="">暂不使用</option>{accountVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.isDefault ? '（默认）' : ''}</option>)}</select></label><label><span>本篇语气</span><select value={strategy.voiceOffset} onChange={(event) => changeStrategy({ voiceOffset: event.target.value as VoiceOffset })}>{voiceOffsets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div><button className="copy-voice-manage" type="button" onClick={onOpenVoiceSettings}><PenLine size={15}/>编辑声音</button></section>}
    <div className="copy-workspace-layout">
      <section className="copy-editor"><header className="copy-editor-head"><div><b>公众号正式正文</b><span>{saveState === 'dirty' || saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : `已保存 ${draftRef.current.updatedAt}`}</span></div><div><button className="text-button" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}><History size={15}/>版本 {artifacts.length}</button><button className="button" type="button" disabled={copyRunActive} onClick={() => void persistDraft()}><Save size={15}/>保存</button></div></header>
        {historyOpen && <section className="copy-version-panel" aria-label="文案版本记录"><header><b>版本记录</b><button className="icon-button" type="button" aria-label="关闭版本记录" onClick={() => setHistoryOpen(false)}><X size={15}/></button></header>{artifacts.length ? <div>{artifacts.map((artifact) => <button type="button" key={artifact.id} onClick={() => setCandidate(artifact)}><span>{artifactTitle(artifact)}</span><small>{artifactStatus(artifact.status)} · V{artifact.version}</small></button>)}</div> : <p>暂无候选版本</p>}</section>}
        <div className="copy-document"><label><span>标题</span><textarea ref={titleRef} rows={1} value={content.title} readOnly={copyRunActive} onChange={(event) => changeContent({ title: event.target.value })} onBlur={() => void persistDraft()}/></label><label><span>正文</span><textarea ref={bodyRef} value={content.body} readOnly={copyRunActive} onChange={(event) => changeContent({ body: event.target.value })} onSelect={captureSelection} onBlur={captureSelection} placeholder="输入公众号母稿，或在右侧告诉文案助手生成和修改要求。"/></label></div>
      </section>
      <ProjectAgent projectId={project.id} stage="COPY" platform="WECHAT" selection={selection} hasAcceptedCopy={hasAcceptedCopy} blockedReason={copyActionBlockedReason} refreshToken={refreshToken} draftId={draftRef.current.id} draftRevision={draftRef.current.revision} draftBody={content.body} onDraftTitleChange={replaceDraftTitle} onClearSelection={() => setSelection(undefined)} onContextChange={setAgentContext} onArtifactOpen={setCandidate} onDraftGenerated={async () => { applyServerDraft(await onReloadDraft()); }} onOpenSettings={(target) => target === 'agent' ? onOpenAgentSettings() : onOpenModelSettings()}/>
    </div>
    {candidate && <CopyCandidateDialog artifact={candidate} current={content} busy={candidateBusy} onAccept={(title) => void acceptCandidate(title)} onReject={() => void rejectCandidate()} onClose={() => candidateBusy === 'idle' && setCandidate(null)}/>}
  </section>;
}
