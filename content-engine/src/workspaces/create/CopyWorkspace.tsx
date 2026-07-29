import { Check, ChevronDown, CircleAlert, History, LoaderCircle, Plus, Save, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, type ContentProject, type ContentVersion } from '../../domain/content';
import type { CreativePlatform, CreativeSkillDefinition, CreativeSkillDimension, ProjectAgentContext, ProjectArtifact, WritingBriefInput } from '../../domain/creative';
import { CopyCandidateDialog } from './CopyCandidateDialog';
import { ProjectAgent } from './ProjectAgent';

const platformOrder: CreativePlatform[] = ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO'];
const sharedDimensions: { id: 'SUBJECT' | 'CONTENT_TYPE' | 'VOICE'; label: string }[] = [
  { id: 'SUBJECT', label: '题材' },
  { id: 'CONTENT_TYPE', label: '内容类型' },
  { id: 'VOICE', label: '语言风格' },
];
const platformDimensions: { id: 'LAYOUT' | 'CHANNEL'; label: string }[] = [
  { id: 'LAYOUT', label: '内容结构' },
  { id: 'CHANNEL', label: '渠道规则' },
];
const platformSlugs = {
  WECHAT: { LAYOUT: 'wechat-longform', CHANNEL: 'wechat' },
  XIAOHONGSHU: { LAYOUT: 'xiaohongshu-carousel', CHANNEL: 'xiaohongshu' },
  ZHIHU: { LAYOUT: 'zhihu-answer', CHANNEL: 'zhihu' },
  WEIBO: { LAYOUT: 'weibo-thread', CHANNEL: 'weibo' },
} as const;

function firstSkill(skills: CreativeSkillDefinition[], dimension: CreativeSkillDimension, slug: string) {
  const candidates = skills.filter((skill) => skill.dimension === dimension);
  return (candidates.find((skill) => skill.slug === slug) ?? candidates[0])?.version.id ?? '';
}

function platformSkills(platform: CreativePlatform, skills: CreativeSkillDefinition[]) {
  return {
    LAYOUT: firstSkill(skills, 'LAYOUT', platformSlugs[platform].LAYOUT),
    CHANNEL: firstSkill(skills, 'CHANNEL', platformSlugs[platform].CHANNEL),
  };
}

function artifactTitle(artifact: ProjectArtifact) {
  const title = artifact.payload.title;
  if (typeof title === 'string' && title.trim()) return title;
  const options = Array.isArray(artifact.payload.titleOptions) ? artifact.payload.titleOptions.filter((item): item is string => typeof item === 'string') : [];
  return options[0] ?? (artifact.type === 'OUTLINE' ? '文案大纲' : '文案候选');
}

function artifactStatus(status: ProjectArtifact['status']) {
  return status === 'ACCEPTED' ? '已采用' : status === 'REJECTED' ? '已废弃' : '待审核';
}

export function CopyWorkspace({ project, brief, briefState, skills, activePlatform, onPlatform, onProjectChange, onSaveBrief, onSaveVersion, onOpenModelSettings, onOpenAgentSettings }: {
  project: ContentProject;
  brief: WritingBriefInput | null;
  briefState: 'loading' | 'saving' | 'saved' | 'error';
  skills: CreativeSkillDefinition[];
  activePlatform: CreativePlatform;
  onPlatform: (platform: CreativePlatform) => void;
  onProjectChange: (project: ContentProject) => void;
  onSaveBrief: (next: WritingBriefInput) => Promise<void>;
  onSaveVersion: (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => void;
  onOpenModelSettings: () => void;
  onOpenAgentSettings: () => void;
}) {
  const versions = useMemo(() => project.versions.filter((version): version is ContentVersion & { platform: CreativePlatform } => version.platform !== 'VIDEO_CHANNEL'), [project.versions]);
  const activeVersion = versions.find((version) => version.platform === activePlatform) ?? versions[0];
  const [draft, setDraft] = useState({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
  const [saveState, setSaveState] = useState<'saved' | 'dirty'>('saved');
  const [strategy, setStrategy] = useState<WritingBriefInput | null>(brief);
  const [strategyState, setStrategyState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [platformMenu, setPlatformMenu] = useState(false);
  const [platformBusy, setPlatformBusy] = useState<CreativePlatform | null>(null);
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | undefined>();
  const [agentContext, setAgentContext] = useState<ProjectAgentContext | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [candidate, setCandidate] = useState<ProjectArtifact | null>(null);
  const [candidateBusy, setCandidateBusy] = useState<'idle' | 'accepting' | 'rejecting'>('idle');
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setStrategy(brief);
    setStrategyState(briefState === 'error' ? 'error' : briefState === 'saving' || briefState === 'loading' ? 'saving' : 'saved');
  }, [brief, briefState]);
  useEffect(() => {
    setDraft({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
    setSaveState('saved'); setSelection(undefined); setCandidate(null); setHistoryOpen(false); setError('');
  }, [activeVersion?.body, activeVersion?.id, activeVersion?.title]);

  useEffect(() => {
    if (saveState !== 'dirty' || !activeVersion) return;
    const timer = window.setTimeout(() => {
      onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
      setSaveState('saved');
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeVersion, draft, onSaveVersion, project.id, saveState]);

  useEffect(() => {
    const resize = (element: HTMLTextAreaElement | null, minimum: number) => {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.max(minimum, element.scrollHeight)}px`;
    };
    resize(titleRef.current, 54); resize(bodyRef.current, 420);
  }, [draft.body, draft.title]);

  const skillGroups = useMemo(() => new Map<CreativeSkillDimension, CreativeSkillDefinition[]>(['SUBJECT', 'CONTENT_TYPE', 'VOICE', 'LAYOUT', 'CHANNEL'].map((dimension) => [dimension as CreativeSkillDimension, skills.filter((skill) => skill.dimension === dimension)])), [skills]);
  const missingPlatforms = platformOrder.filter((platform) => !versions.some((version) => version.platform === platform));
  const artifacts = (agentContext?.artifacts ?? []).filter((artifact) => artifact.type === 'OUTLINE' || artifact.type === 'PLATFORM_COPY');

  const changeDraft = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState('dirty');
    setSelection(undefined);
  };

  const saveDraft = () => {
    if (!activeVersion) return;
    onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
    setSaveState('saved');
  };

  const captureSelection = () => {
    const element = bodyRef.current;
    if (!element || element.selectionStart === element.selectionEnd) { setSelection(undefined); return; }
    setSelection({ text: element.value.slice(element.selectionStart, element.selectionEnd), start: element.selectionStart, end: element.selectionEnd });
  };

  const changeStrategy = (patch: Partial<WritingBriefInput>) => {
    setStrategy((current) => current ? { ...current, ...patch } : current);
    setStrategyState('dirty'); setError('');
  };

  const saveStrategy = async () => {
    if (!strategy) return;
    setStrategyState('saving'); setError('');
    try { await onSaveBrief(strategy); setStrategyState('saved'); }
    catch (reason) { setStrategyState('error'); setError(reason instanceof Error ? reason.message : '写作策略保存失败。'); }
  };

  useEffect(() => {
    if (strategyState !== 'dirty' || !strategy) return;
    const timer = window.setTimeout(() => { void saveStrategy(); }, 700);
    return () => window.clearTimeout(timer);
  }, [strategy, strategyState]);

  const enablePlatform = async (platform: CreativePlatform) => {
    setPlatformBusy(platform); setError('');
    try {
      const result = await webCreative.enableProjectPlatform(project.id, platform);
      if (strategy && !strategy.selectedPlatforms.includes(platform)) {
        const next = { ...strategy, selectedPlatforms: [...strategy.selectedPlatforms, platform], platformSkills: { ...strategy.platformSkills, [platform]: platformSkills(platform, skills) } };
        setStrategy(next);
        await onSaveBrief(next);
      }
      onProjectChange(result.project); onPlatform(platform); setPlatformMenu(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : `启用${platformName[platform]}失败。`); }
    finally { setPlatformBusy(null); }
  };

  const switchPlatform = (platform: CreativePlatform) => {
    setSelection(undefined); onPlatform(platform);
  };

  const acceptCandidate = async (selectedTitle?: string) => {
    if (!candidate) return;
    setCandidateBusy('accepting'); setError('');
    try {
      const result = await webCreative.acceptArtifact(candidate.id, selectedTitle);
      setCandidate(null); onProjectChange(result.project);
      const version = result.project.versions.find((item) => item.platform === activePlatform);
      if (version) setDraft({ title: version.title, body: version.body });
      setSaveState('saved'); setRefreshToken((value) => value + 1);
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

  if (!activeVersion) return <section className="empty-workbench"><h1>还没有图文平台版本</h1></section>;
  const platformStrategy = strategy?.platformSkills[activeVersion.platform];

  return <section className="copy-workspace">
    <header className="copy-platform-bar">
      <nav className="copy-platform-tabs" aria-label="图文平台版本">{versions.map((version) => <button type="button" key={version.platform} className={version.platform === activeVersion.platform ? 'active' : ''} onClick={() => switchPlatform(version.platform)}>{platformName[version.platform]}</button>)}</nav>
      {missingPlatforms.length > 0 && <div className="copy-platform-add"><button className="icon-button" type="button" aria-label="增加图文平台" aria-expanded={platformMenu} onClick={() => setPlatformMenu((value) => !value)}><Plus size={17}/><ChevronDown size={13}/></button>{platformMenu && <div className="copy-platform-menu">{missingPlatforms.map((platform) => <button type="button" key={platform} disabled={Boolean(platformBusy)} onClick={() => void enablePlatform(platform)}>{platformBusy === platform ? <LoaderCircle size={15}/> : <Plus size={15}/>} {platformName[platform]}</button>)}</div>}</div>}
    </header>

    {strategy && <section className="copy-strategy" aria-labelledby="copy-strategy-title"><header><div><h2 id="copy-strategy-title">写作策略</h2><span>{platformName[activeVersion.platform]}</span></div><div className={`copy-strategy-state ${strategyState}`}>{strategyState === 'saving' && '正在保存创作设定'}{strategyState === 'dirty' && '准备自动保存'}{strategyState === 'saved' && '已自动保存'}{strategyState === 'error' && <><span>保存失败</span><button className="text-button" type="button" onClick={() => void saveStrategy()}>重试保存</button></>}</div></header><div className="copy-strategy-fields">{sharedDimensions.map(({ id, label }) => <label key={id}><span>{label}</span><select value={strategy.selectedSkills[id]} onChange={(event) => changeStrategy({ selectedSkills: { ...strategy.selectedSkills, [id]: event.target.value } })}>{(skillGroups.get(id) ?? []).map((skill) => <option key={skill.version.id} value={skill.version.id}>{skill.name}</option>)}</select></label>)}{platformDimensions.map(({ id, label }) => <label key={id}><span>{label}</span><select value={platformStrategy?.[id] ?? ''} onChange={(event) => changeStrategy({ platformSkills: { ...strategy.platformSkills, [activeVersion.platform]: { ...(platformStrategy ?? platformSkills(activeVersion.platform, skills)), [id]: event.target.value } } })}>{(skillGroups.get(id) ?? []).map((skill) => <option key={skill.version.id} value={skill.version.id}>{skill.name}</option>)}</select></label>)}<label><span>目标篇幅</span><input value={strategy.lengthTarget} onChange={(event) => changeStrategy({ lengthTarget: event.target.value })}/></label></div></section>}

    {error && <div className="copy-workspace-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/模型|提示词|任务策略/.test(error) && <button className="text-button" type="button" onClick={onOpenModelSettings}>去配置</button>}</div>}

    <div className="copy-workspace-layout">
      <section className="copy-editor">
        <header className="copy-editor-head"><div><b>正式文案</b><span>{saveState === 'dirty' ? '正在保存' : `已保存 ${activeVersion.updatedAt}`}</span></div><div><button className="text-button" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}><History size={15}/>版本 {artifacts.length}</button><button className="button" type="button" onClick={saveDraft}><Save size={15}/>保存</button></div></header>
        {historyOpen && <section className="copy-version-panel" aria-label="文案版本记录"><header><b>版本记录</b><button className="icon-button" type="button" aria-label="关闭版本记录" onClick={() => setHistoryOpen(false)}><X size={15}/></button></header>{artifacts.length ? <div>{artifacts.map((artifact) => <button type="button" key={artifact.id} onClick={() => setCandidate(artifact)}><span>{artifactTitle(artifact)}</span><small>{artifactStatus(artifact.status)} · V{artifact.version}</small></button>)}</div> : <p>暂无候选版本</p>}</section>}
        <div className="copy-document"><label><span>标题</span><textarea ref={titleRef} rows={1} value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })} onBlur={saveDraft}/></label><label><span>正文</span><textarea ref={bodyRef} value={draft.body} onChange={(event) => changeDraft({ body: event.target.value })} onSelect={captureSelection} onBlur={captureSelection} placeholder="输入草稿，或在右侧告诉 Agent 生成和修改要求。"/></label></div>
      </section>
      <ProjectAgent projectId={project.id} stage="COPY" platform={activeVersion.platform} selection={selection} hasBody={Boolean(draft.body.trim())} blockedReason={strategyState === 'saving' ? '正在保存创作设定' : strategyState === 'error' ? '创作设定保存失败，请重试' : undefined} refreshToken={refreshToken} onClearSelection={() => setSelection(undefined)} onContextChange={setAgentContext} onArtifactOpen={setCandidate} onArtifactAccepted={() => undefined} onOpenSettings={(target) => target === 'agent' ? onOpenAgentSettings() : onOpenModelSettings()}/>
    </div>
    {candidate && <CopyCandidateDialog artifact={candidate} current={draft} busy={candidateBusy} onAccept={(title) => void acceptCandidate(title)} onReject={() => void rejectCandidate()} onClose={() => candidateBusy === 'idle' && setCandidate(null)}/>} 
  </section>;
}
