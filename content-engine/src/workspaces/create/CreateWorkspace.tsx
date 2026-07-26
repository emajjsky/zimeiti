import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { webCreative } from '../../data/webApi';
import type { ContentProject, ContentVersion, Platform } from '../../domain/content';
import { platformName, projectStatusName } from '../../domain/content';
import type { CreativeOutlineCandidate, CreativeOutlineRun, CreativeSkillDefinition, CreativeSkillDimension, CreativeSkillSelection, WritingBriefInput } from '../../domain/creative';

type CreateStage = 'brief' | 'copy' | 'visual' | 'layout' | 'review';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const stages: { id: CreateStage; label: string; enabled: boolean }[] = [
  { id: 'brief', label: '创作设定', enabled: true },
  { id: 'copy', label: '文案', enabled: true },
  { id: 'visual', label: '配图', enabled: false },
  { id: 'layout', label: '排版', enabled: false },
  { id: 'review', label: '审核', enabled: false },
];

const dimensions: { id: CreativeSkillDimension; label: string }[] = [
  { id: 'SUBJECT', label: '题材' },
  { id: 'CONTENT_TYPE', label: '内容类型' },
  { id: 'VOICE', label: '语言风格' },
  { id: 'LAYOUT', label: '排版' },
  { id: 'CHANNEL', label: '渠道' },
];

const emptySelection: CreativeSkillSelection = { SUBJECT: '', CONTENT_TYPE: '', VOICE: '', LAYOUT: '', CHANNEL: '' };

function firstVersion(skills: CreativeSkillDefinition[], dimension: CreativeSkillDimension, preferredSlug?: string) {
  const candidates = skills.filter((skill) => skill.dimension === dimension);
  return (candidates.find((skill) => skill.slug === preferredSlug) ?? candidates[0])?.version.id ?? '';
}

function subjectSlug(project: ContentProject) {
  const value = `${project.title} ${project.coreViewpoint}`;
  if (/财经|金融|股票|基金|经济|公司|商业/.test(value)) return 'finance';
  if (/历史|人物|朝代|文物|人文/.test(value)) return 'history-humanities';
  if (/国学|经典|儒家|道家|易经|论语/.test(value)) return 'chinese-classics';
  if (/\bAI\b|人工智能|模型|科技|软件|工具/i.test(value)) return 'ai-technology';
  return 'general';
}

function defaultBrief(project: ContentProject, skills: CreativeSkillDefinition[]): WritingBriefInput {
  const contentVersions = project.versions.filter((version) => version.platform !== 'VIDEO_CHANNEL');
  const primaryPlatform = contentVersions[0]?.platform ?? 'WECHAT';
  const xhsFirst = primaryPlatform === 'XIAOHONGSHU';
  return {
    objective: `围绕“${project.title}”形成一篇可发布的内容`,
    targetAudience: '',
    coreMessage: project.coreViewpoint,
    sourceRequirements: project.factChecks.join('；'),
    lengthTarget: xhsFirst ? '6-8 页图文' : '1500-2500 字',
    selectedPlatforms: contentVersions.map((version) => version.platform),
    notes: '',
    selectedSkills: {
      SUBJECT: firstVersion(skills, 'SUBJECT', subjectSlug(project)),
      CONTENT_TYPE: firstVersion(skills, 'CONTENT_TYPE', 'education'),
      VOICE: firstVersion(skills, 'VOICE', 'plain-fresh'),
      LAYOUT: firstVersion(skills, 'LAYOUT', xhsFirst ? 'xiaohongshu-carousel' : 'wechat-longform'),
      CHANNEL: firstVersion(skills, 'CHANNEL', xhsFirst ? 'xiaohongshu' : 'wechat'),
    },
  };
}

export function CreateWorkspace({ project, activePlatform, onPlatform, activeVersion, onSaveVersion, onProjectAccepted, onOpenModelSettings }: {
  project: ContentProject | undefined;
  activePlatform: Platform;
  onPlatform: (platform: Platform) => void;
  activeVersion: ContentVersion | undefined;
  onSaveVersion: (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => void;
  onProjectAccepted: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
}) {
  const [stage, setStage] = useState<CreateStage>('brief');
  const [skills, setSkills] = useState<CreativeSkillDefinition[]>([]);
  const [brief, setBrief] = useState<WritingBriefInput | null>(null);
  const [briefState, setBriefState] = useState<SaveState>('idle');
  const [briefError, setBriefError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [draft, setDraft] = useState<Pick<ContentVersion, 'title' | 'body'>>({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
  const [copyState, setCopyState] = useState<'saved' | 'saving'>('saved');
  const [outlineRun, setOutlineRun] = useState<CreativeOutlineRun | null>(null);
  const [outlineCandidate, setOutlineCandidate] = useState<CreativeOutlineCandidate | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [outlineBusy, setOutlineBusy] = useState<'idle' | 'loading' | 'preparing' | 'confirming' | 'cancelling' | 'accepting'>('idle');
  const [outlineError, setOutlineError] = useState('');
  const contentVersions = useMemo(() => project?.versions.filter((version) => version.platform !== 'VIDEO_CHANNEL') ?? [], [project?.versions]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setBrief(null);
    setBriefState('idle');
    setBriefError('');
    void Promise.all([webCreative.skills(), webCreative.brief(project.id)]).then(([catalog, result]) => {
      if (cancelled) return;
      setSkills(catalog);
      setBrief(result.brief ? {
        objective: result.brief.objective,
        targetAudience: result.brief.targetAudience,
        coreMessage: result.brief.coreMessage,
        sourceRequirements: result.brief.sourceRequirements,
        lengthTarget: result.brief.lengthTarget,
        selectedPlatforms: result.brief.selectedPlatforms,
        notes: result.brief.notes,
        selectedSkills: result.brief.selectedSkills,
      } : defaultBrief(project, catalog));
      setSavedAt(result.brief?.updatedAt ?? '');
      setBriefState(result.brief ? 'saved' : 'dirty');
    }).catch((error) => {
      if (cancelled) return;
      setBriefError(error instanceof Error ? error.message : '创作设定加载失败。');
      setBriefState('error');
    });
    return () => { cancelled = true; };
  }, [project?.id]);

  useEffect(() => {
    setDraft({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
    setCopyState('saved');
  }, [activeVersion?.body, activeVersion?.id, activeVersion?.title]);

  useEffect(() => {
    if (contentVersions.length && !contentVersions.some((version) => version.platform === activePlatform)) onPlatform(contentVersions[0].platform);
  }, [activePlatform, contentVersions, onPlatform]);

  const outlinePlatform = activeVersion?.platform === 'WECHAT' || activeVersion?.platform === 'XIAOHONGSHU' ? activeVersion.platform : null;

  useEffect(() => {
    if (!project || !outlinePlatform || stage !== 'copy') return;
    let cancelled = false;
    setOutlineBusy('loading');
    setOutlineError('');
    void Promise.all([
      webCreative.latestOutlineRun(project.id, outlinePlatform),
      webCreative.latestOutline(project.id, outlinePlatform),
    ]).then(([run, candidate]) => {
      if (cancelled) return;
      setOutlineRun(run);
      const visibleCandidate = run?.status === 'SUCCEEDED' || (!run && candidate?.status === 'ACCEPTED') ? candidate : null;
      setOutlineCandidate(visibleCandidate);
      setSelectedTitle(visibleCandidate?.selectedTitle ?? visibleCandidate?.titleOptions[0] ?? '');
    }).catch((error) => {
      if (!cancelled) setOutlineError(error instanceof Error ? error.message : '大纲状态读取失败。');
    }).finally(() => {
      if (!cancelled) setOutlineBusy('idle');
    });
    return () => { cancelled = true; };
  }, [outlinePlatform, project?.id, stage]);

  useEffect(() => {
    if (!project || !outlinePlatform || !outlineRun || !['QUEUED', 'RUNNING'].includes(outlineRun.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await webCreative.latestOutlineRun(project.id, outlinePlatform);
        if (cancelled || !run) return;
        setOutlineRun(run);
        if (run.status === 'SUCCEEDED') {
          const candidate = await webCreative.latestOutline(project.id, outlinePlatform);
          if (cancelled) return;
          setOutlineCandidate(candidate);
          setSelectedTitle(candidate?.selectedTitle ?? candidate?.titleOptions[0] ?? '');
        }
      } catch (error) {
        if (!cancelled) setOutlineError(error instanceof Error ? error.message : '大纲任务状态更新失败。');
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    void refresh();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [outlinePlatform, outlineRun?.id, outlineRun?.status, project?.id]);

  const skillGroups = useMemo(() => new Map(dimensions.map(({ id }) => [id, skills.filter((skill) => skill.dimension === id)])), [skills]);
  const selectedSkillDetails = useMemo(() => new Map(dimensions.map(({ id }) => [id, skills.find((skill) => skill.version.id === brief?.selectedSkills[id])])), [brief?.selectedSkills, skills]);

  const changeBrief = (patch: Partial<WritingBriefInput>) => {
    setBrief((current) => current ? { ...current, ...patch } : current);
    setBriefState('dirty');
    setBriefError('');
  };

  const saveBrief = async () => {
    if (!project || !brief || brief.selectedPlatforms.length === 0) return;
    setBriefState('saving');
    setBriefError('');
    try {
      const result = await webCreative.saveBrief(project.id, brief);
      setBrief({
        objective: result.brief.objective,
        targetAudience: result.brief.targetAudience,
        coreMessage: result.brief.coreMessage,
        sourceRequirements: result.brief.sourceRequirements,
        lengthTarget: result.brief.lengthTarget,
        selectedPlatforms: result.brief.selectedPlatforms,
        notes: result.brief.notes,
        selectedSkills: result.brief.selectedSkills,
      });
      setSavedAt(result.brief.updatedAt);
      setBriefState('saved');
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : '创作设定保存失败。');
      setBriefState('error');
    }
  };

  const changeDraft = (patch: Partial<Pick<ContentVersion, 'title' | 'body'>>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setCopyState('saving');
  };
  useEffect(() => {
    if (copyState !== 'saving' || !project || !activeVersion) return;
    const timer = window.setTimeout(() => {
      onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
      setCopyState('saved');
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeVersion?.id, copyState, draft, onSaveVersion, project?.id]);

  const saveCopy = () => {
    if (!project || !activeVersion) return;
    onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
    setCopyState('saved');
  };

  const prepareOutline = async () => {
    if (!project || !outlinePlatform) return;
    if (briefState !== 'saved') {
      setOutlineError('请先保存创作设定，再生成大纲。');
      return;
    }
    setOutlineBusy('preparing');
    setOutlineError('');
    try {
      const run = await webCreative.prepareOutline(project.id, outlinePlatform);
      setOutlineRun(run);
      setOutlineCandidate(null);
      setSelectedTitle('');
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '大纲准备失败。');
    } finally {
      setOutlineBusy('idle');
    }
  };

  const confirmOutline = async () => {
    if (!outlineRun || outlineRun.status !== 'DRAFT') return;
    setOutlineBusy('confirming');
    setOutlineError('');
    try {
      const result = await webCreative.confirmOutline(outlineRun.id);
      setOutlineRun({ ...outlineRun, status: 'QUEUED', jobId: result.jobId });
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '大纲任务确认失败。');
    } finally {
      setOutlineBusy('idle');
    }
  };

  const cancelOutline = async () => {
    if (!outlineRun || !['DRAFT', 'QUEUED'].includes(outlineRun.status)) return;
    setOutlineBusy('cancelling');
    setOutlineError('');
    try {
      await webCreative.cancelOutline(outlineRun.id);
      setOutlineRun({ ...outlineRun, status: 'CANCELLED' });
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '取消大纲任务失败。');
    } finally {
      setOutlineBusy('idle');
    }
  };

  const acceptOutline = async () => {
    if (!outlineCandidate || !selectedTitle || outlineCandidate.status !== 'CANDIDATE') return;
    setCopyState('saved');
    setOutlineBusy('accepting');
    setOutlineError('');
    try {
      const result = await webCreative.acceptOutline(outlineCandidate.id, selectedTitle);
      setOutlineCandidate(result.candidate);
      onProjectAccepted(result.project);
      const version = result.project.versions.find((item) => item.platform === outlineCandidate.platform);
      if (version) setDraft({ title: version.title, body: version.body });
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '采用大纲失败。');
    } finally {
      setOutlineBusy('idle');
    }
  };

  if (!project) return <section className="empty-workbench"><h1>还没有内容项目</h1><p>请先从选题池确认立项。</p></section>;

  return <>
    <div className="project-heading"><div><div className="eyebrow">CREATE / 内容项目</div><h1 className="page-title">{project.title}</h1><p className="page-subtitle">{projectStatusName[project.status]}</p></div>{stage === 'copy' && activeVersion && <span className={`chip ${copyState === 'saving' ? 'yellow' : 'mint'}`}>{copyState === 'saving' ? '正在保存' : `已保存 ${activeVersion.updatedAt}`}</span>}</div>
    <nav className="creative-stepper" aria-label="创作流程">{stages.map((item, index) => <button type="button" key={item.id} className={stage === item.id ? 'active' : ''} disabled={!item.enabled} onClick={() => item.enabled && setStage(item.id)}><b>{index + 1}</b><span>{item.label}</span></button>)}</nav>

    {stage === 'brief' && <section className="creative-brief-shell">
      {!brief && briefState !== 'error' && <div className="creative-brief-loading"><LoaderCircle size={20}/><span>正在读取创作设定</span></div>}
      {briefState === 'error' && !brief && <div className="creative-brief-error"><CircleAlert size={20}/><div><b>创作设定加载失败</b><p>{briefError}</p></div></div>}
      {brief && <>
        <form className="creative-brief-form" onSubmit={(event) => { event.preventDefault(); void saveBrief(); }}>
          <header><div><h2>创作设定</h2><p>先固定这篇内容要解决的问题，再进入文案。</p></div><button className="button primary" type="submit" disabled={briefState === 'saving' || brief.selectedPlatforms.length === 0}>{briefState === 'saving' ? '保存中' : '保存设定'}</button></header>
          <div className="creative-brief-fields">
            <label><span>创作目标</span><input value={brief.objective} onChange={(event) => changeBrief({ objective: event.target.value })}/></label>
            <label><span>目标受众</span><input value={brief.targetAudience} onChange={(event) => changeBrief({ targetAudience: event.target.value })} placeholder="这篇内容主要写给谁"/></label>
            <label className="wide"><span>核心表达</span><textarea rows={4} value={brief.coreMessage} onChange={(event) => changeBrief({ coreMessage: event.target.value })}/></label>
            <label className="wide"><span>来源与核验要求</span><textarea rows={3} value={brief.sourceRequirements} onChange={(event) => changeBrief({ sourceRequirements: event.target.value })} placeholder="必须引用的来源、数据和待核验事实"/></label>
            <label><span>篇幅目标</span><input value={brief.lengthTarget} onChange={(event) => changeBrief({ lengthTarget: event.target.value })}/></label>
            <fieldset><legend>目标平台</legend><div>{contentVersions.map((version) => <label key={version.platform}><input type="checkbox" checked={brief.selectedPlatforms.includes(version.platform)} onChange={() => changeBrief({ selectedPlatforms: brief.selectedPlatforms.includes(version.platform) ? brief.selectedPlatforms.filter((item) => item !== version.platform) : [...brief.selectedPlatforms, version.platform] })}/><span>{platformName[version.platform]}</span></label>)}</div></fieldset>
            <label className="wide"><span>补充要求</span><textarea rows={3} value={brief.notes} onChange={(event) => changeBrief({ notes: event.target.value })} placeholder="不希望出现的表达、必须保留的例子或其它要求"/></label>
          </div>
          <footer><div className={`creative-save-status ${briefState}`} aria-live="polite">{briefState === 'saved' && <><CheckCircle2 size={16}/><span>已保存{savedAt ? ` ${new Date(savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></>}{briefState === 'dirty' && <span>有未保存修改</span>}{briefState === 'error' && <><CircleAlert size={16}/><span>{briefError}</span></>}</div></footer>
        </form>
        <aside className="creative-skill-panel"><header><h2>Skill 组合</h2><span>5 个维度</span></header><div className="creative-skill-fields">{dimensions.map(({ id, label }) => <label key={id}><span>{label}</span><select value={brief.selectedSkills[id]} onChange={(event) => changeBrief({ selectedSkills: { ...brief.selectedSkills, [id]: event.target.value } })}>{(skillGroups.get(id) ?? []).map((skill) => <option key={skill.version.id} value={skill.version.id}>{skill.name}</option>)}</select><small>{selectedSkillDetails.get(id)?.description}</small></label>)}</div></aside>
      </>}
    </section>}

    {stage === 'copy' && (activeVersion && activeVersion.platform !== 'VIDEO_CHANNEL' ? <div className="create-layout editable creative-copy-layout"><section className="editor"><div className="editor-head"><div className="tabs">{contentVersions.map((version) => <button type="button" key={version.platform} className={version.platform === activePlatform ? 'active' : ''} onClick={() => onPlatform(version.platform)}>{platformName[version.platform]}</button>)}</div><button className="text-button" type="button" onClick={saveCopy}>保存草稿</button></div><div className="editor-tools">{platformName[activeVersion.platform]}文案</div>
      {outlineCandidate && <section className={`outline-review ${outlineCandidate.status === 'ACCEPTED' ? 'accepted' : ''}`} aria-label="大纲候选">
        <header><div><span>{outlineCandidate.status === 'ACCEPTED' ? '已采用' : '候选大纲'}</span><b>{outlineCandidate.model}</b></div>{outlineCandidate.status === 'ACCEPTED' && <CheckCircle2 size={20}/>}</header>
        <div className="outline-review-body">
          <fieldset disabled={outlineCandidate.status === 'ACCEPTED'}><legend>标题方案</legend>{outlineCandidate.titleOptions.map((title) => <label key={title}><input type="radio" name={`outline-title-${outlineCandidate.id}`} checked={selectedTitle === title} onChange={() => setSelectedTitle(title)}/><span>{title}</span></label>)}</fieldset>
          <p className="outline-summary">{outlineCandidate.summary}</p>
          <ol className="outline-sections">{outlineCandidate.sections.map((section) => <li key={section.heading}><div><b>{section.heading}</b><span>{section.purpose}</span></div><ul>{section.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></li>)}</ol>
          {outlineCandidate.factsToVerify.length > 0 && <div className="outline-facts"><b>待核验</b><ul>{outlineCandidate.factsToVerify.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>}
        </div>
        {outlineCandidate.status === 'CANDIDATE' && <footer><button className="text-button" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void prepareOutline()}><RotateCcw size={15}/>重新生成</button><button className="button primary" type="button" disabled={!selectedTitle || outlineBusy !== 'idle'} onClick={() => void acceptOutline()}>{outlineBusy === 'accepting' ? <LoaderCircle size={16}/> : <Check size={16}/>}采用大纲</button></footer>}
      </section>}
      <div className="document editor-document"><label>标题<input value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })} onBlur={saveCopy}/></label><label>正文<textarea value={draft.body} onChange={(event) => changeDraft({ body: event.target.value })} onBlur={saveCopy} placeholder="从核心观点开始，写出这期内容的完整表达。"/></label></div></section>
      <aside className="assistant-panel creative-agent-panel"><header><div><Sparkles size={18}/><h2>大纲 Agent</h2></div><span>{platformName[activeVersion.platform]}</span></header>
        {outlineBusy === 'loading' && <div className="outline-state loading"><LoaderCircle size={18}/><span>读取任务状态</span></div>}
        {outlineBusy !== 'loading' && !outlineRun && <div className="outline-state idle"><p>从当前创作设定生成大纲候选。</p><button className="button primary" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void prepareOutline()}>{outlineBusy === 'preparing' ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成大纲</button></div>}
        {outlineRun?.status === 'DRAFT' && <div className="outline-confirmation"><div className="outline-confirmation-head"><b>确认本次生成</b><span>{outlineRun.confirmation.actionVersion}</span></div><dl><div><dt>模型</dt><dd>{outlineRun.confirmation.model}</dd></div><div><dt>平台</dt><dd>{platformName[outlineRun.confirmation.platform]}</dd></div></dl><div className="outline-skill-list">{outlineRun.confirmation.skills.map((skill) => <div key={skill.dimension}><span>{dimensions.find((item) => item.id === skill.dimension)?.label}</span><b>{skill.name}</b><small>v{skill.version}</small></div>)}</div><footer><button className="icon-button" type="button" title="取消" aria-label="取消本次生成" disabled={outlineBusy !== 'idle'} onClick={() => void cancelOutline()}><X size={17}/></button><button className="button primary" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void confirmOutline()}>{outlineBusy === 'confirming' ? <LoaderCircle size={16}/> : <Check size={16}/>}确认生成</button></footer></div>}
        {outlineRun && ['QUEUED', 'RUNNING'].includes(outlineRun.status) && <div className="outline-state running"><LoaderCircle size={20}/><b>{outlineRun.status === 'QUEUED' ? '等待执行' : '正在生成大纲'}</b>{outlineRun.status === 'QUEUED' && <button className="text-button" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void cancelOutline()}>取消任务</button>}</div>}
        {outlineRun?.status === 'FAILED' && <div className="outline-state failed"><CircleAlert size={19}/><b>生成失败</b><p>{outlineRun.error || '模型任务执行失败。'}</p><button className="text-button" type="button" onClick={() => void prepareOutline()}>重新准备</button></div>}
        {outlineRun?.status === 'CANCELLED' && <div className="outline-state cancelled"><b>已取消</b><button className="button primary" type="button" onClick={() => void prepareOutline()}>重新生成</button></div>}
        {outlineRun?.status === 'SUCCEEDED' && outlineCandidate && <div className={`outline-state ${outlineCandidate.status === 'ACCEPTED' ? 'accepted' : 'ready'}`}><CheckCircle2 size={19}/><b>{outlineCandidate.status === 'ACCEPTED' ? '大纲已写入文案' : '大纲等待审核'}</b></div>}
        {outlineError && <div className="outline-inline-error" role="alert"><CircleAlert size={17}/><p>{outlineError}</p>{/配置可用文本模型|配置可用/.test(outlineError) && <button className="text-button" type="button" onClick={onOpenModelSettings}>去配置任务策略</button>}</div>}
        <div className="creative-checks"><div><b>平台版本</b><span>{contentVersions.length} 个</span></div><div><b>待核验事实</b><span>{project.factChecks.length} 项</span></div></div>
      </aside></div> : <section className="empty-workbench"><h1>还没有图文平台版本</h1><p>当前主流程支持公众号和小红书。</p></section>)}
  </>;
}
