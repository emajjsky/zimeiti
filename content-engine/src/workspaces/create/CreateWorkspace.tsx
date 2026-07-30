import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CreateStageRoute } from '../../app/navigation.mjs';
import { webAccountVoices, webCreative } from '../../data/webApi';
import { canOpenCreateStage, creativeStages, stageRouteForProjectStage } from '../../domain/creative-flow.mjs';
import { projectStageName, type ContentProject, type ContentVersion, type Platform } from '../../domain/content';
import type { AccountVoiceProfile, CreativePlatform, CreativePlatformSkillMap, CreativeSkillDefinition, CreativeSkillDimension, CreativeSkillSelection, WritingBriefInput } from '../../domain/creative';
import { CopyWorkspace } from './CopyWorkspace';
import { LayoutWorkspace } from './LayoutWorkspace';
import { PlanningWorkspace } from './PlanningWorkspace';
import { ProjectAgent } from './ProjectAgent';
import { ProjectMaterials } from './ProjectMaterials';
import { ReviewWorkspace } from './ReviewWorkspace';
import { VisualWorkspace } from './VisualWorkspace';

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
    const defaultLength = platform === 'XIAOHONGSHU' ? '300-800 字，6-8 页图文卡片' : platform === 'WEIBO' ? '140-500 字，必要时串文' : platform === 'ZHIHU' ? '1500-3000 字' : '1500-2500 字';
    result[platform] = { ...(current[platform] ?? {
      LAYOUT: firstVersion(skills, 'LAYOUT', slugs.layout),
      CHANNEL: firstVersion(skills, 'CHANNEL', slugs.channel),
    }), lengthTarget: current[platform]?.lengthTarget ?? defaultLength };
    return result;
  }, { ...current });
}

function defaultBrief(project: ContentProject, skills: CreativeSkillDefinition[], accountVoiceProfileId = ''): WritingBriefInput {
  const contentVersions = project.versions.filter((version): version is ContentVersion & { platform: CreativePlatform } => version.platform !== 'VIDEO_CHANNEL');
  const primaryPlatform = contentVersions[0]?.platform ?? 'WECHAT';
  const lengthTarget = primaryPlatform === 'XIAOHONGSHU' ? '6-8 页图文' : primaryPlatform === 'WEIBO' ? '300-1000 字或 3-8 条串文' : primaryPlatform === 'ZHIHU' ? '1500-3000 字' : '1500-2500 字';
  return {
    objective: project.planning.objective || `围绕“${project.title}”形成一篇可发布的内容`,
    targetAudience: project.planning.targetAudience,
    coreMessage: project.planning.coreMessage || project.coreViewpoint,
    sourceRequirements: project.planning.sourceRequirements || project.factChecks.join('；'),
    lengthTarget,
    selectedPlatforms: contentVersions.map((version) => version.platform),
    notes: project.planning.constraints,
    selectedSkills: {
      ...emptySelection,
      SUBJECT: firstVersion(skills, 'SUBJECT', subjectSlug(project)),
      CONTENT_TYPE: firstVersion(skills, 'CONTENT_TYPE', 'education'),
      VOICE: '',
    },
    platformSkills: platformSkillDefaults(contentVersions.map((version) => version.platform), skills),
    accountVoiceProfileId,
    voiceOffset: 'DEFAULT',
  };
}

export function CreateWorkspace({ project, stage, onStage, onExitProject, activePlatform, onPlatform, onSaveVersion, onProjectAccepted, onOpenModelSettings, onOpenAgentSettings, onOpenSearchSettings, onOpenVoiceSettings }: {
  project: ContentProject | undefined;
  stage: CreateStageRoute;
  onStage: (stage: CreateStageRoute) => void;
  onExitProject: () => void;
  activePlatform: Platform;
  onPlatform: (platform: Platform) => void;
  onSaveVersion: (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => void;
  onProjectAccepted: (project: ContentProject) => void;
  onOpenModelSettings: () => void;
  onOpenAgentSettings: () => void;
  onOpenSearchSettings: () => void;
  onOpenVoiceSettings: () => void;
}) {
  const [skills, setSkills] = useState<CreativeSkillDefinition[]>([]);
  const [accountVoices, setAccountVoices] = useState<AccountVoiceProfile[]>([]);
  const [brief, setBrief] = useState<WritingBriefInput | null>(null);
  const [briefState, setBriefState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [briefError, setBriefError] = useState('');
  const contentVersions = useMemo(() => project?.versions.filter((version): version is ContentVersion & { platform: CreativePlatform } => version.platform !== 'VIDEO_CHANNEL') ?? [], [project?.versions]);
  const copyPlatform = activePlatform !== 'VIDEO_CHANNEL' && contentVersions.some((version) => version.platform === activePlatform) ? activePlatform : contentVersions[0]?.platform;

  useEffect(() => {
    if (!project) return;
    if (stage === 'platform' || stage === 'visual' || stage === 'layout' || stage === 'review') { onStage('master'); return; }
    if (!canOpenCreateStage(project.stage, stage)) onStage(stageRouteForProjectStage(project.stage));
  }, [onStage, project?.stage, stage]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setBrief(null);
    setBriefState('loading');
    setBriefError('');
    void Promise.all([webCreative.skills(), webCreative.brief(project.id), webAccountVoices.list()]).then(async ([catalog, result, accountVoices]) => {
      if (cancelled) return;
      setSkills(catalog);
      setAccountVoices(accountVoices.voices);
      const defaultVoiceId = accountVoices.voices.find((voice) => voice.isDefault)?.id ?? '';
      if (result.brief && !result.brief.accountVoiceProfileId && defaultVoiceId) {
        result.brief = (await webCreative.saveBrief(project.id, {
          objective: result.brief.objective,
          targetAudience: result.brief.targetAudience,
          coreMessage: result.brief.coreMessage,
          sourceRequirements: result.brief.sourceRequirements,
          lengthTarget: result.brief.lengthTarget,
          selectedPlatforms: result.brief.selectedPlatforms,
          notes: result.brief.notes,
          selectedSkills: result.brief.selectedSkills,
          platformSkills: platformSkillDefaults(result.brief.selectedPlatforms, catalog, result.brief.platformSkills),
          accountVoiceProfileId: defaultVoiceId,
          voiceOffset: result.brief.voiceOffset ?? 'DEFAULT',
        })).brief;
      }
      if (result.brief) {
        setBrief({
        objective: result.brief.objective,
        targetAudience: result.brief.targetAudience,
        coreMessage: result.brief.coreMessage,
        sourceRequirements: result.brief.sourceRequirements,
        lengthTarget: result.brief.lengthTarget,
        selectedPlatforms: result.brief.selectedPlatforms,
        notes: result.brief.notes,
        accountVoiceProfileId: result.brief.accountVoiceProfileId,
        voiceOffset: result.brief.voiceOffset,
        selectedSkills: result.brief.selectedSkills,
        platformSkills: platformSkillDefaults(result.brief.selectedPlatforms, catalog, result.brief.platformSkills),
        });
        setBriefState('saved');
        return;
      }
      const defaults = defaultBrief(project, catalog, accountVoices.voices.find((voice) => voice.isDefault)?.id ?? '');
      setBrief(defaults);
      setBriefState('saving');
      const saved = await webCreative.saveBrief(project.id, defaults);
      if (cancelled) return;
      setBrief({
        objective: saved.brief.objective,
        targetAudience: saved.brief.targetAudience,
        coreMessage: saved.brief.coreMessage,
        sourceRequirements: saved.brief.sourceRequirements,
        lengthTarget: saved.brief.lengthTarget,
        selectedPlatforms: saved.brief.selectedPlatforms,
        notes: saved.brief.notes,
        accountVoiceProfileId: saved.brief.accountVoiceProfileId,
        voiceOffset: saved.brief.voiceOffset,
        selectedSkills: saved.brief.selectedSkills,
        platformSkills: saved.brief.platformSkills,
      });
      setBriefState('saved');
    }).catch((error) => {
      if (!cancelled) {
        setBriefState('error');
        setBriefError(error instanceof Error ? error.message : '正文配置保存失败');
      }
    });
    return () => { cancelled = true; };
  }, [project?.id]);

  useEffect(() => {
    if (contentVersions.length && !contentVersions.some((version) => version.platform === activePlatform)) onPlatform(contentVersions[0].platform);
  }, [activePlatform, contentVersions, onPlatform]);

  const saveBrief = async (next: WritingBriefInput = brief as WritingBriefInput) => {
    if (!project || !next || next.selectedPlatforms.length === 0) return;
    setBrief(next);
    setBriefState('saving');
    setBriefError('');
    try {
      const result = await webCreative.saveBrief(project.id, next);
      setBrief({
        objective: result.brief.objective,
        targetAudience: result.brief.targetAudience,
        coreMessage: result.brief.coreMessage,
        sourceRequirements: result.brief.sourceRequirements,
        lengthTarget: result.brief.lengthTarget,
        selectedPlatforms: result.brief.selectedPlatforms,
        notes: result.brief.notes,
        accountVoiceProfileId: result.brief.accountVoiceProfileId,
        voiceOffset: result.brief.voiceOffset,
        selectedSkills: result.brief.selectedSkills,
        platformSkills: result.brief.platformSkills,
      });
      setBriefState('saved');
    } catch (error) {
      setBriefState('error');
      setBriefError(error instanceof Error ? error.message : '正文配置保存失败');
      throw error;
    }
  };

  const completePlatformVersions = async (platform: CreativePlatform) => {
    if (!project) return;
    try {
      const result = await webCreative.completePlatformVersions(project.id, platform);
      onProjectAccepted(result.project);
    } catch (error) { throw error; }
  };

  const handleCopyProjectChange = (nextProject: ContentProject) => {
    onProjectAccepted(nextProject);
  };

  if (!project) return <section className="empty-workbench"><h1>还没有内容项目</h1></section>;

  return <section className="creative-workspace">
    <header className="creative-workspace-head">
      <button className="text-button" type="button" onClick={onExitProject}><ArrowLeft size={16}/>项目中心</button>
      <div><h1>{project.title}</h1><span>{projectStageName[project.stage]}</span></div>
    </header>

    <nav className="creative-stage-nav" aria-label="创作流程">
      {creativeStages.map((item) => {
        const enabled = canOpenCreateStage(project.stage, item.id);
        return <button type="button" key={item.id} className={stage === item.id ? 'active' : ''} disabled={!enabled} onClick={() => enabled && onStage(item.id)}><span>{item.label}</span></button>;
      })}
    </nav>

    {stage === 'planning' && <PlanningWorkspace project={project} onProjectChange={onProjectAccepted} onComplete={(next) => { onProjectAccepted(next); onStage('master'); }} />}
    {stage === 'research' && <div className="project-research-layout">
      <ProjectMaterials project={project} platforms={contentVersions.map((version) => version.platform)}/>
      <ProjectAgent projectId={project.id} stage="RESEARCH" onArtifactAccepted={(_artifact, nextProject) => { if (!nextProject) return; onProjectAccepted(nextProject); onStage('master'); }} onOpenSettings={(target) => target === 'search' ? onOpenSearchSettings() : onOpenAgentSettings()}/>
    </div>}
    {stage === 'master' && briefError && <div className="creative-stage-error"><CircleAlert size={18}/><span>{briefError}</span></div>}
    {stage === 'master' && copyPlatform && (!project.delivery?.platforms?.[copyPlatform] || project.delivery.platforms[copyPlatform]?.stage === 'COPY') && <CopyWorkspace project={project} brief={brief} briefState={briefState} skills={skills} accountVoices={accountVoices} activePlatform={copyPlatform} onPlatform={onPlatform} onProjectChange={handleCopyProjectChange} onSaveBrief={saveBrief} onSaveVersion={onSaveVersion} onOpenResearch={() => onStage('research')} onCompletePlatforms={completePlatformVersions} onOpenModelSettings={onOpenModelSettings} onOpenAgentSettings={onOpenAgentSettings} onOpenVoiceSettings={onOpenVoiceSettings} />}
    {stage === 'master' && !copyPlatform && <div className="creative-stage-empty"><h2>没有可写作的图文平台</h2><p>请先在规划中选择公众号、小红书、知乎或微博。</p></div>}
    {stage === 'master' && copyPlatform && project.delivery?.platforms?.[copyPlatform]?.stage === 'VISUAL' && <VisualWorkspace project={project} activePlatform={copyPlatform} onPlatform={onPlatform} onProjectChange={onProjectAccepted} onOpenMaterials={() => onStage('research')} />}
    {stage === 'master' && copyPlatform && project.delivery?.platforms?.[copyPlatform]?.stage === 'LAYOUT' && <LayoutWorkspace project={project} activePlatform={copyPlatform} onPlatform={onPlatform} onProjectChange={onProjectAccepted} />}
    {stage === 'master' && copyPlatform && ['REVIEW', 'READY'].includes(project.delivery?.platforms?.[copyPlatform]?.stage ?? '') && <ReviewWorkspace project={project} activePlatform={copyPlatform} onPlatform={onPlatform} onProjectChange={onProjectAccepted}/>}
  </section>;
}
