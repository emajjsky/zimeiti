import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { webCreative } from '../../data/webApi';
import type { ContentProject, ContentVersion, Platform } from '../../domain/content';
import { platformName, projectStatusName } from '../../domain/content';
import type { CreativeDraftCandidate, CreativeDraftRun, CreativeOutlineCandidate, CreativeOutlineRun, CreativePlatform, CreativePlatformSkillMap, CreativeSkillDefinition, CreativeSkillDimension, CreativeSkillSelection, WritingBriefInput } from '../../domain/creative';

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
const sharedDimensions: { id: 'SUBJECT' | 'CONTENT_TYPE' | 'VOICE'; label: string }[] = [
  { id: 'SUBJECT', label: '题材' },
  { id: 'CONTENT_TYPE', label: '内容类型' },
  { id: 'VOICE', label: '语言风格' },
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
    platformSkills: platformSkillDefaults(contentVersions.map((version) => version.platform), skills),
  };
}

function platformSkillDefaults(platforms: Platform[], skills: CreativeSkillDefinition[], current: CreativePlatformSkillMap = {}) {
  return platforms.reduce<CreativePlatformSkillMap>((result, platform) => {
    if (platform !== 'WECHAT' && platform !== 'XIAOHONGSHU') return result;
    const xhs = platform === 'XIAOHONGSHU';
    result[platform] = current[platform] ?? {
      LAYOUT: firstVersion(skills, 'LAYOUT', xhs ? 'xiaohongshu-carousel' : 'wechat-longform'),
      CHANNEL: firstVersion(skills, 'CHANNEL', xhs ? 'xiaohongshu' : 'wechat'),
    };
    return result;
  }, { ...current });
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
  const [outlineReviewOpen, setOutlineReviewOpen] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState<'idle' | 'loading' | 'preparing' | 'confirming' | 'cancelling' | 'accepting'>('idle');
  const [outlineError, setOutlineError] = useState('');
  const [draftRun, setDraftRun] = useState<CreativeDraftRun | null>(null);
  const [draftCandidate, setDraftCandidate] = useState<CreativeDraftCandidate | null>(null);
  const [draftReviewOpen, setDraftReviewOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState<'idle' | 'loading' | 'preparing' | 'confirming' | 'cancelling' | 'accepting'>('idle');
  const [draftError, setDraftError] = useState('');
  const titleEditorRef = useRef<HTMLTextAreaElement>(null);
  const bodyEditorRef = useRef<HTMLTextAreaElement>(null);
  const outlineDialogRef = useRef<HTMLDivElement>(null);
  const draftDialogRef = useRef<HTMLDivElement>(null);
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
        platformSkills: platformSkillDefaults(result.brief.selectedPlatforms, catalog, result.brief.platformSkills),
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
    const resize = (element: HTMLTextAreaElement | null, minimum: number) => {
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${Math.max(element.scrollHeight, minimum)}px`;
    };
    resize(titleEditorRef.current, 56);
    resize(bodyEditorRef.current, 360);
  }, [draft.body, draft.title, stage]);

  useEffect(() => {
    if (!outlineReviewOpen && !draftReviewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOutlineReviewOpen(false);
      setDraftReviewOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => (draftReviewOpen ? draftDialogRef.current : outlineDialogRef.current)?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [draftReviewOpen, outlineReviewOpen]);

  useEffect(() => {
    if (contentVersions.length && !contentVersions.some((version) => version.platform === activePlatform)) onPlatform(contentVersions[0].platform);
  }, [activePlatform, contentVersions, onPlatform]);

  const outlinePlatform = activeVersion?.platform === 'WECHAT' || activeVersion?.platform === 'XIAOHONGSHU' ? activeVersion.platform : null;

  useEffect(() => {
    if (!project || !outlinePlatform || stage !== 'copy') return;
    let cancelled = false;
    setOutlineBusy('loading');
    setDraftBusy('loading');
    setOutlineError('');
    setDraftError('');
    void Promise.all([
      webCreative.latestOutlineRun(project.id, outlinePlatform),
      webCreative.latestOutline(project.id, outlinePlatform),
      webCreative.latestDraftRun(project.id, outlinePlatform),
      webCreative.latestDraft(project.id, outlinePlatform),
    ]).then(([run, candidate, currentDraftRun, currentDraftCandidate]) => {
      if (cancelled) return;
      setOutlineRun(run);
      setOutlineCandidate(candidate);
      setSelectedTitle(candidate?.selectedTitle ?? candidate?.titleOptions[0] ?? '');
      setDraftRun(currentDraftRun);
      setDraftCandidate(currentDraftCandidate);
    }).catch((error) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : '创作任务状态读取失败。';
        setOutlineError(message);
        setDraftError(message);
      }
    }).finally(() => {
      if (!cancelled) {
        setOutlineBusy('idle');
        setDraftBusy('idle');
      }
    });
    return () => { cancelled = true; };
  }, [outlinePlatform, project?.id, stage]);

  useEffect(() => {
    if (outlineCandidate?.status === 'CANDIDATE') setOutlineReviewOpen(true);
  }, [outlineCandidate?.id, outlineCandidate?.status]);

  useEffect(() => {
    if (draftCandidate?.status !== 'CANDIDATE') return;
    setOutlineReviewOpen(false);
    setDraftReviewOpen(true);
  }, [draftCandidate?.id, draftCandidate?.status]);

  useEffect(() => {
    if (!project || !outlinePlatform || !outlineRun || !['QUEUED', 'RUNNING'].includes(outlineRun.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await webCreative.latestOutlineRun(project.id, outlinePlatform);
        if (cancelled || !run) return;
        let candidate: CreativeOutlineCandidate | null = null;
        if (run.status === 'SUCCEEDED') {
          candidate = await webCreative.latestOutline(project.id, outlinePlatform);
        }
        if (cancelled) return;
        setOutlineRun(run);
        if (run.status === 'SUCCEEDED') {
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

  useEffect(() => {
    if (!project || !outlinePlatform || !draftRun || !['QUEUED', 'RUNNING'].includes(draftRun.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const run = await webCreative.latestDraftRun(project.id, outlinePlatform);
        if (cancelled || !run) return;
        let candidate: CreativeDraftCandidate | null = null;
        if (run.status === 'SUCCEEDED') {
          candidate = await webCreative.latestDraft(project.id, outlinePlatform);
        }
        if (cancelled) return;
        setDraftRun(run);
        if (run.status === 'SUCCEEDED') setDraftCandidate(candidate);
      } catch (error) {
        if (!cancelled) setDraftError(error instanceof Error ? error.message : '初稿任务状态更新失败。');
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    void refresh();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [draftRun?.id, draftRun?.status, outlinePlatform, project?.id]);

  const skillGroups = useMemo(() => new Map(dimensions.map(({ id }) => [id, skills.filter((skill) => skill.dimension === id)])), [skills]);
  const skillDescription = (versionId: string | undefined) => skills.find((skill) => skill.version.id === versionId)?.description;
  const skillName = (versionId: string | undefined) => skills.find((skill) => skill.version.id === versionId)?.name ?? '未配置';

  const changeBrief = (patch: Partial<WritingBriefInput>) => {
    setBrief((current) => current ? { ...current, ...patch } : current);
    setBriefState('dirty');
    setBriefError('');
  };

  const toggleBriefPlatform = (platform: CreativePlatform) => {
    if (!brief) return;
    const selectedPlatforms = brief.selectedPlatforms.includes(platform)
      ? brief.selectedPlatforms.filter((item) => item !== platform)
      : [...brief.selectedPlatforms, platform];
    changeBrief({ selectedPlatforms, platformSkills: platformSkillDefaults(selectedPlatforms, skills, brief.platformSkills) });
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
        platformSkills: result.brief.platformSkills,
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
      setOutlineError('请先保存创作设定和写作策略，再生成大纲。');
      return;
    }
    setOutlineBusy('preparing');
    setOutlineError('');
    try {
      const run = await webCreative.prepareOutline(project.id, outlinePlatform);
      setOutlineRun(run);
      setOutlineCandidate((current) => current?.status === 'ACCEPTED' ? current : null);
      setSelectedTitle((current) => outlineCandidate?.status === 'ACCEPTED' ? current : '');
      setOutlineReviewOpen(false);
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
      setOutlineReviewOpen(false);
      setDraftRun(null);
      setDraftCandidate(null);
      setDraftReviewOpen(false);
      onProjectAccepted(result.project);
      const version = result.project.versions.find((item) => item.platform === outlineCandidate.platform);
      if (version) setDraft({ title: version.title, body: version.body });
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '采用大纲失败。');
    } finally {
      setOutlineBusy('idle');
    }
  };

  const prepareDraft = async () => {
    if (!project || !outlinePlatform || outlineCandidate?.status !== 'ACCEPTED') return;
    setDraftBusy('preparing');
    setDraftError('');
    try {
      const run = await webCreative.prepareDraft(project.id, outlinePlatform);
      setDraftRun(run);
      setDraftCandidate((current) => current?.status === 'ACCEPTED' ? current : null);
      setDraftReviewOpen(false);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : '初稿准备失败。');
    } finally {
      setDraftBusy('idle');
    }
  };

  const confirmDraft = async () => {
    if (!draftRun || draftRun.status !== 'DRAFT') return;
    setDraftBusy('confirming');
    setDraftError('');
    try {
      const result = await webCreative.confirmDraft(draftRun.id);
      setDraftRun({ ...draftRun, status: 'QUEUED', jobId: result.jobId });
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : '初稿任务确认失败。');
    } finally {
      setDraftBusy('idle');
    }
  };

  const cancelDraft = async () => {
    if (!draftRun || !['DRAFT', 'QUEUED'].includes(draftRun.status)) return;
    setDraftBusy('cancelling');
    setDraftError('');
    try {
      await webCreative.cancelDraft(draftRun.id);
      setDraftRun({ ...draftRun, status: 'CANCELLED' });
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : '取消初稿任务失败。');
    } finally {
      setDraftBusy('idle');
    }
  };

  const acceptDraft = async () => {
    if (!draftCandidate || draftCandidate.status !== 'CANDIDATE') return;
    setCopyState('saved');
    setDraftBusy('accepting');
    setDraftError('');
    try {
      const result = await webCreative.acceptDraft(draftCandidate.id);
      setDraftCandidate(result.candidate);
      setDraftReviewOpen(false);
      onProjectAccepted(result.project);
      const version = result.project.versions.find((item) => item.platform === draftCandidate.platform);
      if (version) setDraft({ title: version.title, body: version.body });
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : '采用初稿失败。');
    } finally {
      setDraftBusy('idle');
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
            <fieldset><legend>目标平台</legend><div>{contentVersions.map((version) => <label key={version.platform}><input type="checkbox" checked={brief.selectedPlatforms.includes(version.platform)} onChange={() => toggleBriefPlatform(version.platform as CreativePlatform)}/><span>{platformName[version.platform]}</span></label>)}</div></fieldset>
            <label className="wide"><span>补充要求</span><textarea rows={3} value={brief.notes} onChange={(event) => changeBrief({ notes: event.target.value })} placeholder="不希望出现的表达、必须保留的例子或其它要求"/></label>
          </div>
          <footer><div className={`creative-save-status ${briefState}`} aria-live="polite">{briefState === 'saved' && <><CheckCircle2 size={16}/><span>已保存{savedAt ? ` ${new Date(savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></>}{briefState === 'dirty' && <span>有未保存修改</span>}{briefState === 'error' && <><CircleAlert size={16}/><span>{briefError}</span></>}</div></footer>
        </form>
      </>}
    </section>}

    {stage === 'copy' && (activeVersion && activeVersion.platform !== 'VIDEO_CHANNEL' ? <div className="create-layout editable creative-copy-layout"><section className="editor"><div className="editor-head"><div className="tabs">{contentVersions.map((version) => <button type="button" key={version.platform} className={version.platform === activePlatform ? 'active' : ''} onClick={() => onPlatform(version.platform)}>{platformName[version.platform]}</button>)}</div><button className="text-button" type="button" onClick={saveCopy}>保存草稿</button></div>
      {brief && <section className="writing-strategy" aria-labelledby="writing-strategy-title"><header><div><h2 id="writing-strategy-title">写作策略</h2><span>{platformName[activeVersion.platform]}文案</span></div><button className="text-button" type="button" disabled={briefState === 'saving'} onClick={() => void saveBrief()}>{briefState === 'saving' ? '保存中' : briefState === 'saved' ? '已保存' : '保存策略'}</button></header><div className="writing-strategy-fields">{sharedDimensions.map(({ id, label }) => <label key={id}><span>{label}</span><select value={brief.selectedSkills[id]} onChange={(event) => changeBrief({ selectedSkills: { ...brief.selectedSkills, [id]: event.target.value } })}>{(skillGroups.get(id) ?? []).map((skill) => <option key={skill.version.id} value={skill.version.id}>{skill.name}</option>)}</select><small>{skillDescription(brief.selectedSkills[id])}</small></label>)}<div className="writing-channel-rule"><span>平台规则</span><b>{skillName(brief.platformSkills[activeVersion.platform as CreativePlatform]?.CHANNEL)}</b><small>随当前平台自动绑定</small></div></div>{briefError && <div className="writing-strategy-error" role="alert"><CircleAlert size={16}/><span>{briefError}</span></div>}</section>}
      <div className="editor-tools">{platformName[activeVersion.platform]}文案</div>
      <div className="document editor-document"><label>标题<textarea ref={titleEditorRef} rows={1} value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })} onBlur={saveCopy}/></label><label>正文<textarea ref={bodyEditorRef} value={draft.body} onChange={(event) => changeDraft({ body: event.target.value })} onBlur={saveCopy} placeholder="从核心观点开始，写出这期内容的完整表达。"/></label></div></section>
      <aside className="assistant-panel creative-agent-panel"><header><div><Sparkles size={18}/><h2>创作 Agent</h2></div><span>{platformName[activeVersion.platform]}</span></header>
        {(outlineBusy === 'loading' || draftBusy === 'loading') && <div className="outline-state loading"><LoaderCircle size={18}/><span>读取任务状态</span></div>}
        {outlineBusy !== 'loading' && !outlineRun && outlineCandidate?.status !== 'ACCEPTED' && <div className="outline-state idle"><p>按当前平台和写作策略生成大纲。</p><button className="button primary" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void prepareOutline()}>{outlineBusy === 'preparing' ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成大纲</button></div>}
        {outlineRun?.status === 'DRAFT' && <div className="outline-confirmation"><div className="outline-confirmation-head"><b>确认生成大纲</b><span>{outlineRun.confirmation.actionVersion}</span></div><dl><div><dt>模型</dt><dd>{outlineRun.confirmation.model}</dd></div><div><dt>目标</dt><dd>{platformName[outlineRun.confirmation.platform]}图文 · 提示词 V{outlineRun.confirmation.promptVersion}</dd></div></dl><div className="outline-skill-list">{outlineRun.confirmation.skills.map((skill) => <div key={skill.dimension}><span>{dimensions.find((item) => item.id === skill.dimension)?.label}</span><b>{skill.name}</b><small>v{skill.version}</small></div>)}</div><footer><button className="icon-button" type="button" title="取消" aria-label="取消本次生成" disabled={outlineBusy !== 'idle'} onClick={() => void cancelOutline()}><X size={17}/></button><button className="button primary" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void confirmOutline()}>{outlineBusy === 'confirming' ? <LoaderCircle size={16}/> : <Check size={16}/>}确认生成</button></footer></div>}
        {outlineRun && ['QUEUED', 'RUNNING'].includes(outlineRun.status) && <div className="outline-state running"><LoaderCircle size={20}/><b>{outlineRun.status === 'QUEUED' ? '等待执行' : '正在生成大纲'}</b>{outlineRun.status === 'QUEUED' && <button className="text-button" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void cancelOutline()}>取消任务</button>}</div>}
        {outlineRun?.status === 'FAILED' && <div className="outline-state failed"><CircleAlert size={19}/><b>生成失败</b><p>{outlineRun.error || '模型任务执行失败。'}</p><button className="text-button" type="button" onClick={() => void prepareOutline()}>重新准备</button></div>}
        {outlineRun?.status === 'CANCELLED' && <div className="outline-state cancelled"><b>已取消</b><button className="button primary" type="button" onClick={() => void prepareOutline()}>重新生成</button></div>}
        {outlineCandidate && (outlineRun?.status === 'SUCCEEDED' || outlineCandidate.status === 'ACCEPTED') && <div className={`outline-state ${outlineCandidate.status === 'ACCEPTED' ? 'accepted' : 'ready'}`}><CheckCircle2 size={19}/><div><b>{outlineCandidate.status === 'ACCEPTED' ? '大纲已采用' : '大纲待审核'}</b><span>{outlineCandidate.status === 'ACCEPTED' ? '下一步：生成初稿' : '确认结构后再进入正文写作'}</span></div><button className="text-button outline-state-action" type="button" onClick={() => setOutlineReviewOpen(true)}>{outlineCandidate.status === 'ACCEPTED' ? '查看大纲' : '审核大纲'}</button></div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftBusy !== 'loading' && !draftRun && !draftCandidate && <div className="outline-state idle draft-start"><p>按已采用大纲生成完整初稿。</p><button className="button primary" type="button" disabled={draftBusy !== 'idle'} onClick={() => void prepareDraft()}>{draftBusy === 'preparing' ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}生成初稿</button></div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftRun?.status === 'DRAFT' && <div className="outline-confirmation draft-confirmation"><div className="outline-confirmation-head"><b>确认生成初稿</b><span>{draftRun.confirmation.actionVersion}</span></div><dl><div><dt>模型</dt><dd>{draftRun.confirmation.model}</dd></div><div><dt>目标</dt><dd>{platformName[draftRun.confirmation.platform]}图文 · 提示词 V{draftRun.confirmation.promptVersion}</dd></div></dl><div className="outline-skill-list">{draftRun.confirmation.skills.map((skill) => <div key={skill.dimension}><span>{dimensions.find((item) => item.id === skill.dimension)?.label}</span><b>{skill.name}</b><small>v{skill.version}</small></div>)}</div><footer><button className="icon-button" type="button" title="取消" aria-label="取消生成初稿" disabled={draftBusy !== 'idle'} onClick={() => void cancelDraft()}><X size={17}/></button><button className="button primary" type="button" disabled={draftBusy !== 'idle'} onClick={() => void confirmDraft()}>{draftBusy === 'confirming' ? <LoaderCircle size={16}/> : <Check size={16}/>}确认生成</button></footer></div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftRun && ['QUEUED', 'RUNNING'].includes(draftRun.status) && <div className="outline-state running"><LoaderCircle size={20}/><b>{draftRun.status === 'QUEUED' ? '初稿等待执行' : '正在生成初稿'}</b>{draftRun.status === 'QUEUED' && <button className="text-button" type="button" disabled={draftBusy !== 'idle'} onClick={() => void cancelDraft()}>取消任务</button>}</div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftRun?.status === 'FAILED' && <div className="outline-state failed"><CircleAlert size={19}/><b>初稿生成失败</b><p>{draftRun.error || '模型任务执行失败。'}</p><button className="text-button" type="button" onClick={() => void prepareDraft()}>重新准备</button></div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftRun?.status === 'CANCELLED' && <div className="outline-state cancelled"><b>初稿任务已取消</b><button className="button primary" type="button" onClick={() => void prepareDraft()}>重新生成</button></div>}
        {outlineCandidate?.status === 'ACCEPTED' && draftCandidate && (draftRun?.status === 'SUCCEEDED' || draftCandidate.status === 'ACCEPTED') && <div className={`outline-state ${draftCandidate.status === 'ACCEPTED' ? 'accepted' : 'ready'}`}><CheckCircle2 size={19}/><div><b>{draftCandidate.status === 'ACCEPTED' ? '初稿已采用' : '初稿待审核'}</b><span>{draftCandidate.status === 'ACCEPTED' ? '正文已更新' : '采用后才会写入正文'}</span></div><button className="text-button outline-state-action" type="button" onClick={() => setDraftReviewOpen(true)}>{draftCandidate.status === 'ACCEPTED' ? '查看初稿' : '审核初稿'}</button></div>}
        {outlineError && <div className="outline-inline-error" role="alert"><CircleAlert size={17}/><p>{outlineError}</p>{/配置可用文本模型|配置可用/.test(outlineError) && <button className="text-button" type="button" onClick={onOpenModelSettings}>去配置任务策略</button>}</div>}
        {draftError && draftError !== outlineError && <div className="outline-inline-error" role="alert"><CircleAlert size={17}/><p>{draftError}</p>{/配置可用文本模型|配置可用/.test(draftError) && <button className="text-button" type="button" onClick={onOpenModelSettings}>去配置任务策略</button>}</div>}
        <div className="creative-checks"><div><b>平台版本</b><span>{contentVersions.length} 个</span></div><div><b>待核验事实</b><span>{project.factChecks.length} 项</span></div></div>
      </aside></div> : <section className="empty-workbench"><h1>还没有图文平台版本</h1><p>当前主流程支持公众号和小红书。</p></section>)}

    {outlineReviewOpen && outlineCandidate && <div className="outline-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOutlineReviewOpen(false); }}>
      <div ref={outlineDialogRef} className={`outline-dialog ${outlineCandidate.status === 'ACCEPTED' ? 'accepted' : ''}`} role="dialog" aria-modal="true" aria-labelledby="outline-dialog-title" tabIndex={-1}>
        <header><div><span>{outlineCandidate.status === 'ACCEPTED' ? '已采用大纲' : '审核大纲'}</span><b>{outlineCandidate.model}</b></div><button className="icon-button" type="button" aria-label="关闭大纲" onClick={() => setOutlineReviewOpen(false)}><X size={18}/></button></header>
        <div className="outline-dialog-body">
          <fieldset disabled={outlineCandidate.status === 'ACCEPTED'}><legend id="outline-dialog-title">标题方案</legend>{outlineCandidate.titleOptions.map((title) => <label key={title}><input type="radio" name={`outline-title-${outlineCandidate.id}`} checked={selectedTitle === title} onChange={() => setSelectedTitle(title)}/><span>{title}</span></label>)}</fieldset>
          <section className="outline-summary" aria-label="大纲摘要"><b>内容摘要</b><p>{outlineCandidate.summary}</p></section>
          <section className="outline-structure" aria-label="章节结构"><h3>章节结构</h3><ol className="outline-sections">{outlineCandidate.sections.map((section) => <li key={section.heading}><div><b>{section.heading}</b><span>{section.purpose}</span></div><ul>{section.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></li>)}</ol></section>
          {outlineCandidate.factsToVerify.length > 0 && <div className="outline-facts"><b>待核验</b><ul>{outlineCandidate.factsToVerify.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>}
        </div>
        <footer>{outlineCandidate.status === 'CANDIDATE' ? <><button className="text-button" type="button" disabled={outlineBusy !== 'idle'} onClick={() => void prepareOutline()}><RotateCcw size={15}/>重新生成</button><button className="button primary" type="button" disabled={!selectedTitle || outlineBusy !== 'idle'} onClick={() => void acceptOutline()}>{outlineBusy === 'accepting' ? <LoaderCircle size={16}/> : <Check size={16}/>}采用大纲</button></> : <button className="button primary" type="button" onClick={() => setOutlineReviewOpen(false)}>返回文案</button>}</footer>
      </div>
    </div>}
    {draftReviewOpen && draftCandidate && <div className="outline-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDraftReviewOpen(false); }}>
      <div ref={draftDialogRef} className={`outline-dialog draft-review-dialog ${draftCandidate.status === 'ACCEPTED' ? 'accepted' : ''}`} role="dialog" aria-modal="true" aria-labelledby="draft-dialog-title" tabIndex={-1}>
        <header><div><span>{draftCandidate.status === 'ACCEPTED' ? '已采用初稿' : '审核初稿'}</span><b>{draftCandidate.model}</b></div><button className="icon-button" type="button" aria-label="关闭初稿" onClick={() => setDraftReviewOpen(false)}><X size={18}/></button></header>
        <div className="outline-dialog-body draft-review-body">
          <section className="draft-review-title"><span>标题</span><h2 id="draft-dialog-title">{draftCandidate.title}</h2></section>
          <article className="draft-review-copy" aria-label="初稿正文">{draftCandidate.body}</article>
          {draftCandidate.factsToVerify.length > 0 && <div className="outline-facts"><b>待核验</b><ul>{draftCandidate.factsToVerify.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>}
        </div>
        <footer>{draftCandidate.status === 'CANDIDATE' ? <><button className="text-button" type="button" disabled={draftBusy !== 'idle'} onClick={() => void prepareDraft()}><RotateCcw size={15}/>重新生成</button><button className="button primary" type="button" disabled={draftBusy !== 'idle'} onClick={() => void acceptDraft()}>{draftBusy === 'accepting' ? <LoaderCircle size={16}/> : <Check size={16}/>}采用为正文</button></> : <button className="button primary" type="button" onClick={() => setDraftReviewOpen(false)}>返回文案</button>}</footer>
      </div>
    </div>}
  </>;
}
