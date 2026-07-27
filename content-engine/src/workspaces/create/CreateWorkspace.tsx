import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webCreative } from '../../data/webApi';
import { platformName, projectStatusName, type ContentProject, type ContentVersion, type Platform } from '../../domain/content';
import type { CreativePlatform, CreativePlatformSkillMap, CreativeSkillDefinition, CreativeSkillDimension, CreativeSkillSelection, WritingBriefInput } from '../../domain/creative';
import { CopyWorkspace } from './CopyWorkspace';
import { ProjectMaterials } from './ProjectMaterials';

type CreateStage = 'brief' | 'materials' | 'copy' | 'visual' | 'layout' | 'review';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const stages: { id: CreateStage; label: string; enabled: boolean }[] = [
  { id: 'brief', label: '项目概览', enabled: true },
  { id: 'materials', label: '资料与研究', enabled: true },
  { id: 'copy', label: '文案', enabled: true },
  { id: 'visual', label: '配图', enabled: false },
  { id: 'layout', label: '排版', enabled: false },
  { id: 'review', label: '审核', enabled: false },
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

function platformSkillDefaults(platforms: Platform[], skills: CreativeSkillDefinition[], current: CreativePlatformSkillMap = {}) {
  return platforms.reduce<CreativePlatformSkillMap>((result, platform) => {
    if (platform === 'VIDEO_CHANNEL') return result;
    const slugs = {
      WECHAT: { layout: 'wechat-longform', channel: 'wechat' },
      XIAOHONGSHU: { layout: 'xiaohongshu-carousel', channel: 'xiaohongshu' },
      ZHIHU: { layout: 'zhihu-answer', channel: 'zhihu' },
      WEIBO: { layout: 'weibo-thread', channel: 'weibo' },
    }[platform];
    result[platform] = current[platform] ?? {
      LAYOUT: firstVersion(skills, 'LAYOUT', slugs.layout),
      CHANNEL: firstVersion(skills, 'CHANNEL', slugs.channel),
    };
    return result;
  }, { ...current });
}

function defaultBrief(project: ContentProject, skills: CreativeSkillDefinition[]): WritingBriefInput {
  const contentVersions = project.versions.filter((version): version is ContentVersion & { platform: CreativePlatform } => version.platform !== 'VIDEO_CHANNEL');
  const primaryPlatform = contentVersions[0]?.platform ?? 'WECHAT';
  const lengthTarget = primaryPlatform === 'XIAOHONGSHU' ? '6-8 页图文' : primaryPlatform === 'WEIBO' ? '300-1000 字或 3-8 条串文' : primaryPlatform === 'ZHIHU' ? '1500-3000 字' : '1500-2500 字';
  return {
    objective: `围绕“${project.title}”形成一篇可发布的内容`,
    targetAudience: '',
    coreMessage: project.coreViewpoint,
    sourceRequirements: project.factChecks.join('；'),
    lengthTarget,
    selectedPlatforms: contentVersions.map((version) => version.platform),
    notes: '',
    selectedSkills: {
      ...emptySelection,
      SUBJECT: firstVersion(skills, 'SUBJECT', subjectSlug(project)),
      CONTENT_TYPE: firstVersion(skills, 'CONTENT_TYPE', 'education'),
      VOICE: firstVersion(skills, 'VOICE', 'plain-fresh'),
    },
    platformSkills: platformSkillDefaults(contentVersions.map((version) => version.platform), skills),
  };
}

export function CreateWorkspace({ project, activePlatform, onPlatform, onSaveVersion, onProjectAccepted, onOpenModelSettings, onOpenAgentSettings }: {
  project: ContentProject | undefined;
  activePlatform: Platform;
  onPlatform: (platform: Platform) => void;
  onSaveVersion: (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => void;
  onProjectAccepted: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
  onOpenAgentSettings: () => void;
}) {
  const [stage, setStage] = useState<CreateStage>('brief');
  const [skills, setSkills] = useState<CreativeSkillDefinition[]>([]);
  const [brief, setBrief] = useState<WritingBriefInput | null>(null);
  const [briefState, setBriefState] = useState<SaveState>('idle');
  const [briefError, setBriefError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const contentVersions = useMemo(() => project?.versions.filter((version): version is ContentVersion & { platform: CreativePlatform } => version.platform !== 'VIDEO_CHANNEL') ?? [], [project?.versions]);
  const copyPlatform = activePlatform !== 'VIDEO_CHANNEL' && contentVersions.some((version) => version.platform === activePlatform) ? activePlatform : contentVersions[0]?.platform;

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setBrief(null); setBriefState('idle'); setBriefError('');
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
    if (contentVersions.length && !contentVersions.some((version) => version.platform === activePlatform)) onPlatform(contentVersions[0].platform);
  }, [activePlatform, contentVersions, onPlatform]);

  const changeBrief = (patch: Partial<WritingBriefInput>) => {
    setBrief((current) => current ? { ...current, ...patch } : current);
    setBriefState('dirty'); setBriefError('');
  };

  const toggleBriefPlatform = (platform: CreativePlatform) => {
    if (!brief) return;
    const selectedPlatforms = brief.selectedPlatforms.includes(platform) ? brief.selectedPlatforms.filter((item) => item !== platform) : [...brief.selectedPlatforms, platform];
    changeBrief({ selectedPlatforms, platformSkills: platformSkillDefaults(selectedPlatforms, skills, brief.platformSkills) });
  };

  const saveBrief = async (next: WritingBriefInput = brief as WritingBriefInput) => {
    if (!project || !next || next.selectedPlatforms.length === 0) return;
    setBrief(next); setBriefState('saving'); setBriefError('');
    try {
      const result = await webCreative.saveBrief(project.id, next);
      const saved = {
        objective: result.brief.objective,
        targetAudience: result.brief.targetAudience,
        coreMessage: result.brief.coreMessage,
        sourceRequirements: result.brief.sourceRequirements,
        lengthTarget: result.brief.lengthTarget,
        selectedPlatforms: result.brief.selectedPlatforms,
        notes: result.brief.notes,
        selectedSkills: result.brief.selectedSkills,
        platformSkills: result.brief.platformSkills,
      };
      setBrief(saved); setSavedAt(result.brief.updatedAt); setBriefState('saved');
    } catch (error) {
      setBriefError(error instanceof Error ? error.message : '创作设定保存失败。'); setBriefState('error');
      throw error;
    }
  };

  if (!project) return <section className="empty-workbench"><h1>还没有内容项目</h1><p>请先从选题池确认立项。</p></section>;

  return <>
    <div className="project-heading"><div><div className="eyebrow">CREATE / 内容项目</div><h1 className="page-title">{project.title}</h1><p className="page-subtitle">{projectStatusName[project.status]}</p></div></div>
    <nav className="creative-stepper" aria-label="创作流程">{stages.map((item, index) => <button type="button" key={item.id} className={stage === item.id ? 'active' : ''} disabled={!item.enabled} onClick={() => item.enabled && setStage(item.id)}><b>{index + 1}</b><span>{item.label}</span></button>)}</nav>

    {stage === 'brief' && <section className="creative-brief-shell">
      {!brief && briefState !== 'error' && <div className="creative-brief-loading"><LoaderCircle size={20}/><span>正在读取项目概览</span></div>}
      {briefState === 'error' && !brief && <div className="creative-brief-error"><CircleAlert size={20}/><div><b>项目概览加载失败</b><p>{briefError}</p></div></div>}
      {brief && <form className="creative-brief-form" onSubmit={(event) => { event.preventDefault(); void saveBrief().catch(() => undefined); }}>
        <header><div><h2>项目概览</h2></div><button className="button primary" type="submit" disabled={briefState === 'saving' || brief.selectedPlatforms.length === 0}>{briefState === 'saving' ? '保存中' : '保存概览'}</button></header>
        <div className="creative-brief-fields">
          <label><span>创作目标</span><input value={brief.objective} onChange={(event) => changeBrief({ objective: event.target.value })}/></label>
          <label><span>目标受众</span><input value={brief.targetAudience} onChange={(event) => changeBrief({ targetAudience: event.target.value })} placeholder="这篇内容主要写给谁"/></label>
          <label className="wide"><span>核心表达</span><textarea rows={4} value={brief.coreMessage} onChange={(event) => changeBrief({ coreMessage: event.target.value })}/></label>
          <label className="wide"><span>来源与核验要求</span><textarea rows={3} value={brief.sourceRequirements} onChange={(event) => changeBrief({ sourceRequirements: event.target.value })} placeholder="必须引用的来源、数据和待核验事实"/></label>
          <fieldset><legend>目标平台</legend><div>{contentVersions.map((version) => <label key={version.platform}><input type="checkbox" checked={brief.selectedPlatforms.includes(version.platform)} onChange={() => toggleBriefPlatform(version.platform)}/><span>{platformName[version.platform]}</span></label>)}</div></fieldset>
          <label className="wide"><span>补充要求</span><textarea rows={3} value={brief.notes} onChange={(event) => changeBrief({ notes: event.target.value })} placeholder="不希望出现的表达、必须保留的例子或其它要求"/></label>
        </div>
        <footer><div className={`creative-save-status ${briefState}`} aria-live="polite">{briefState === 'saved' && <><CheckCircle2 size={16}/><span>已保存{savedAt ? ` ${new Date(savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></>}{briefState === 'dirty' && <span>有未保存修改</span>}{briefState === 'error' && <><CircleAlert size={16}/><span>{briefError}</span></>}</div></footer>
      </form>}
    </section>}

    {stage === 'materials' && <ProjectMaterials projectId={project.id} platforms={contentVersions.map((version) => version.platform)} overviewReady={briefState === 'saved'} hasDraft={contentVersions.some((version) => Boolean(version.body.trim()) && (version.body.trim() !== project.coreViewpoint.trim() || version.title.trim() !== project.title.trim()))} onOpenAgentSettings={onOpenAgentSettings}/>}

    {stage === 'copy' && copyPlatform && <CopyWorkspace project={project} brief={brief} skills={skills} activePlatform={copyPlatform} onPlatform={onPlatform} onProjectChange={onProjectAccepted} onSaveBrief={saveBrief} onSaveVersion={onSaveVersion} onOpenModelSettings={onOpenModelSettings} onOpenAgentSettings={onOpenAgentSettings}/>}
  </>;
}
