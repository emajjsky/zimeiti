import { ArrowLeft, CircleAlert, Film, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CreateStageRoute } from '../../app/navigation.mjs';
import { webAccountVoices, webCreative, webDrafts } from '../../data/webApi';
import { canOpenCreateStage, creativeStages, stageRouteForProjectStage } from '../../domain/creative-flow.mjs';
import { projectStageName, type ContentProject } from '../../domain/content';
import type { ContentDraft, ContentDraftVersion } from '../../domain/content-drafts';
import { defaultWritingLengthTarget, normalizeWritingLengthTarget, type AccountVoiceProfile, type CreativeSkillDefinition, type CreativeSkillDimension, type CreativeSkillSelection, type WritingBrief, type WritingBriefInput } from '../../domain/creative';
import { CopyWorkspace } from './CopyWorkspace';
import { DraftResultWorkspace } from './DraftResultWorkspace';
import { LayoutWorkspace } from './LayoutWorkspace';
import { PreparationWorkspace } from './PreparationWorkspace';
import { VisualWorkspace } from './VisualWorkspace';

const emptySelection: CreativeSkillSelection = { SUBJECT: '', CONTENT_TYPE: '', VOICE: '', LAYOUT: '', CHANNEL: '' };
const routeOrder: CreateStageRoute[] = ['preparation', 'copy', 'visual', 'layout', 'drafts'];

function firstVersion(skills: CreativeSkillDefinition[], dimension: CreativeSkillDimension, preferredSlug: string) {
  const candidates = skills.filter((skill) => skill.dimension === dimension);
  return (candidates.find((skill) => skill.slug === preferredSlug) ?? candidates[0])?.version.id ?? '';
}

function wechatSkills(skills: CreativeSkillDefinition[], lengthTarget = defaultWritingLengthTarget) {
  return {
    LAYOUT: firstVersion(skills, 'LAYOUT', 'wechat-longform'),
    CHANNEL: firstVersion(skills, 'CHANNEL', 'wechat'),
    lengthTarget,
  };
}

function defaultBrief(project: ContentProject, skills: CreativeSkillDefinition[], accountVoiceProfileId = ''): WritingBriefInput {
  const value = `${project.title} ${project.coreViewpoint}`;
  const subject = /财经|金融|股票|基金|经济|公司|商业/.test(value) ? 'finance'
    : /历史|人物|朝代|文物|人文/.test(value) ? 'history-humanities'
      : /国学|经典|儒家|道家|易经|论语/.test(value) ? 'chinese-classics'
        : /\bAI\b|人工智能|模型|科技|软件|工具/i.test(value) ? 'ai-technology' : 'general';
  return {
    objective: project.planning.objective || `围绕“${project.title}”形成一篇公众号文章`,
    targetAudience: project.planning.targetAudience,
    coreMessage: project.planning.coreMessage || project.coreViewpoint,
    sourceRequirements: project.planning.sourceRequirements || project.factChecks.join('；'),
    lengthTarget: defaultWritingLengthTarget,
    selectedPlatforms: ['WECHAT'],
    notes: project.planning.constraints,
    selectedSkills: { ...emptySelection, SUBJECT: firstVersion(skills, 'SUBJECT', subject), CONTENT_TYPE: firstVersion(skills, 'CONTENT_TYPE', 'education') },
    platformSkills: { WECHAT: wechatSkills(skills) },
    accountVoiceProfileId,
    voiceOffset: 'DEFAULT',
  };
}

function briefInput(brief: WritingBrief, skills: CreativeSkillDefinition[]): WritingBriefInput {
  const lengthTarget = normalizeWritingLengthTarget(brief.platformSkills.WECHAT?.lengthTarget || brief.lengthTarget);
  return {
    objective: brief.objective,
    targetAudience: brief.targetAudience,
    coreMessage: brief.coreMessage,
    sourceRequirements: brief.sourceRequirements,
    lengthTarget,
    selectedPlatforms: ['WECHAT'],
    notes: brief.notes,
    accountVoiceProfileId: brief.accountVoiceProfileId,
    voiceOffset: brief.voiceOffset,
    selectedSkills: brief.selectedSkills,
    platformSkills: { WECHAT: wechatSkills(skills, lengthTarget) },
  };
}

function requiresWechatBriefNormalization(brief: WritingBrief, normalized: WritingBriefInput) {
  const current = brief.platformSkills.WECHAT;
  const expected = normalized.platformSkills.WECHAT;
  return brief.selectedPlatforms.length !== 1
    || brief.selectedPlatforms[0] !== 'WECHAT'
    || Object.keys(brief.platformSkills).some((platform) => platform !== 'WECHAT')
    || current?.LAYOUT !== expected?.LAYOUT
    || current?.CHANNEL !== expected?.CHANNEL
    || current?.lengthTarget !== expected?.lengthTarget
    || brief.lengthTarget !== normalized.lengthTarget;
}

function draftRoute(project: ContentProject, draft: ContentDraft | null): CreateStageRoute {
  const projectRoute = stageRouteForProjectStage(project.stage);
  let resourceRoute: CreateStageRoute = project.stage === 'PLANNING' || project.stage === 'RESEARCH' ? 'preparation' : 'copy';
  if (draft?.body.trim().length && draft.body.trim().length >= 80) resourceRoute = 'visual';
  if (draft?.visualPlan.workflowStatus === 'COMPLETE') resourceRoute = 'layout';
  if (draft?.status === 'READY') resourceRoute = 'drafts';
  return routeOrder[Math.max(routeOrder.indexOf(projectRoute), routeOrder.indexOf(resourceRoute))] ?? 'preparation';
}

export function CreateWorkspace({ project, stage, activeDerivedDraftId, onStage, onActiveDerivedDraftChange, onExitProject, onProjectAccepted, onPublish, onOpenModelSettings, onOpenAgentSettings, onOpenSearchSettings, onOpenVoiceSettings }: {
  project: ContentProject | undefined;
  stage: CreateStageRoute | null;
  activeDerivedDraftId: string;
  onStage: (stage: CreateStageRoute) => void;
  onActiveDerivedDraftChange: (draftId: string) => void;
  onExitProject: () => void;
  onProjectAccepted: (project: ContentProject) => void;
  onPublish: () => void;
  onOpenModelSettings: () => void;
  onOpenAgentSettings: () => void;
  onOpenSearchSettings: () => void;
  onOpenVoiceSettings: () => void;
}) {
  const [skills, setSkills] = useState<CreativeSkillDefinition[]>([]);
  const [accountVoices, setAccountVoices] = useState<AccountVoiceProfile[]>([]);
  const [brief, setBrief] = useState<WritingBriefInput | null>(null);
  const [briefState, setBriefState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [wechatDraft, setWechatDraft] = useState<ContentDraft | null>(null);
  const [projectDrafts, setProjectDrafts] = useState<ContentDraft[]>([]);
  const [completedVersion, setCompletedVersion] = useState<ContentDraftVersion | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [error, setError] = useState('');
  const [videoAnalyses, setVideoAnalyses] = useState<Awaited<ReturnType<typeof webCreative.videoAnalyses>>['analyses']>([]);
  const [videoAnalysisState, setVideoAnalysisState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [videoAnalysisError, setVideoAnalysisError] = useState('');
  const videoProgressLabel = (analysis: typeof videoAnalyses[number]) => {
    if (analysis.status === 'SUCCEEDED') return analysis.result?.coverage && analysis.result.coverage.ratio < 1 ? `拉片部分完成，已提取 ${analysis.keyframeAssetIds.length} 张素材，覆盖 ${Math.round(analysis.result.coverage.ratio * 100)}%` : `已提取 ${analysis.keyframeAssetIds.length} 张内容关键帧素材`;
    if (analysis.status === 'FAILED') return '拉片失败';
    if (analysis.progress.phase === 'DETECTING_SCENES') return '正在检测镜头和场景变化';
    if (analysis.progress.phase === 'ANALYZING_SEGMENTS') return `正在分段理解视频 ${analysis.progress.completedSegments}/${analysis.progress.totalSegments}`;
    if (analysis.progress.phase === 'EXTRACTING_MATERIALS' || analysis.status === 'EXTRACTING_FRAMES') return '正在整理时间轴并提取可复用素材';
    return '正在解析视频信息';
  };

  const loadProjectDrafts = useCallback(async () => {
    if (!project) throw new Error('没有可读取的内容项目。');
    const result = await webDrafts.list(project.id);
    let draft = result.drafts.find((item) => item.platform === 'WECHAT') ?? null;
    let drafts = result.drafts;
    if (!draft) {
      const version = project.versions.find((item) => item.platform === 'WECHAT');
      draft = await webDrafts.upsertWechat(project.id, { title: version?.title ?? project.title, body: version?.body ?? '' });
      drafts = [draft, ...drafts];
    }
    setProjectDrafts(drafts);
    setWechatDraft(draft);
    return drafts;
  }, [project?.id]);

  const loadWechatDraft = useCallback(async () => {
    const drafts = await loadProjectDrafts();
    const draft = drafts.find((item) => item.platform === 'WECHAT');
    if (!draft) throw new Error('公众号母稿读取失败。');
    return draft;
  }, [loadProjectDrafts]);

  const updateProjectDraft = useCallback((updated: ContentDraft) => {
    setProjectDrafts((current) => current.some(({ id }) => id === updated.id)
      ? current.map((item) => item.id === updated.id ? updated : item)
      : [...current, updated]);
    if (updated.platform === 'WECHAT') setWechatDraft(updated);
  }, []);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoadingDraft(true); setError(''); setCompletedVersion(null);
    void loadProjectDrafts().then((drafts) => {
      const draft = drafts.find((item) => item.platform === 'WECHAT');
      if (cancelled || !draft || draft.status !== 'READY') return;
      return webDrafts.versions(draft.id).then(({ versions }) => { if (!cancelled) setCompletedVersion(versions.find(({ id }) => id === draft.currentVersionId) ?? versions[0] ?? null); });
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取公众号草稿失败。'); })
      .finally(() => { if (!cancelled) setLoadingDraft(false); });
    return () => { cancelled = true; };
  }, [loadProjectDrafts, project?.id]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      if (!videoAnalyses.length) setVideoAnalysisState('loading');
      try {
        const result = await webCreative.videoAnalyses(project.id);
        if (cancelled) return;
        setVideoAnalyses(result.analyses);
        setVideoAnalysisState('ready');
        setVideoAnalysisError('');
        if (result.analyses.some((item) => ['ANALYZING', 'EXTRACTING_FRAMES'].includes(item.status))) timer = window.setTimeout(() => void load(), 1_500);
      } catch (reason) {
        if (!cancelled) {
          setVideoAnalysisState('error');
          setVideoAnalysisError(reason instanceof Error ? reason.message : '读取拉片状态失败。');
          timer = window.setTimeout(() => void load(), 3_000);
        }
      }
    };
    void load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [project?.id]);

  const currentRoute = useMemo(() => project ? draftRoute(project, wechatDraft) : 'preparation', [project, wechatDraft]);
  const visibleStage = loadingDraft && stage ? stage : stage && routeOrder.indexOf(stage) <= routeOrder.indexOf(currentRoute) ? stage : currentRoute;
  const hasActiveDerivedDraft = projectDrafts.some(({ id, platform }) => id === activeDerivedDraftId && platform !== 'WECHAT');
  const videoAnalysisInProgress = videoAnalysisState === 'loading'
    || videoAnalyses.some((analysis) => ['ANALYZING', 'EXTRACTING_FRAMES'].includes(analysis.status));
  const showVideoAnalysis = videoAnalysisInProgress || visibleStage === 'preparation';
  useEffect(() => { if (project && stage !== visibleStage) onStage(visibleStage); }, [onStage, project?.id, stage, visibleStage]);

  useEffect(() => {
    if (!project || visibleStage === 'preparation') return;
    let cancelled = false;
    setBrief(null); setBriefState('loading');
    void Promise.all([webCreative.skills(), webCreative.brief(project.id), webAccountVoices.list()]).then(async ([catalog, result, voices]) => {
      if (cancelled) return;
      setSkills(catalog); setAccountVoices(voices.voices);
      const fallback = defaultBrief(project, catalog, voices.voices.find((voice) => voice.isDefault)?.id ?? '');
      const normalized = result.brief ? briefInput(result.brief, catalog) : fallback;
      if (!result.brief || requiresWechatBriefNormalization(result.brief, normalized)) {
        setBriefState('saving');
        const saved = await webCreative.saveBrief(project.id, normalized);
        if (cancelled) return;
        setBrief(briefInput(saved.brief, catalog));
      } else {
        setBrief(normalized);
      }
      setBriefState('saved');
    }).catch((reason) => { if (!cancelled) { setBriefState('error'); setError(reason instanceof Error ? reason.message : '正文配置读取失败。'); } });
    return () => { cancelled = true; };
  }, [project?.id, visibleStage === 'preparation']);

  const saveBrief = async (next: WritingBriefInput) => {
    if (!project) return;
    const lengthTarget = normalizeWritingLengthTarget(next.platformSkills.WECHAT?.lengthTarget || next.lengthTarget);
    const normalized: WritingBriefInput = { ...next, lengthTarget, selectedPlatforms: ['WECHAT'], platformSkills: { WECHAT: wechatSkills(skills, lengthTarget) } };
    setBrief(normalized); setBriefState('saving');
    try {
      const result = await webCreative.saveBrief(project.id, normalized);
      setBrief(briefInput(result.brief, skills)); setBriefState('saved');
    } catch (reason) {
      setBriefState('error'); setError(reason instanceof Error ? reason.message : '正文配置保存失败。'); throw reason;
    }
  };

  if (!project) return <section className="empty-workbench"><h1>还没有内容项目</h1></section>;
  return <section className="creative-workspace">
    <header className="creative-workspace-head"><button className="text-button" type="button" onClick={onExitProject}><ArrowLeft size={16}/>项目中心</button><div><h1>{project.title}</h1><span>{projectStageName[project.stage]}</span></div></header>
    {!videoAnalysisInProgress && !hasActiveDerivedDraft && <nav className="creative-stage-nav" aria-label="公众号母稿流程">{creativeStages.map((item) => { const enabled = canOpenCreateStage(project.stage, item.id) || routeOrder.indexOf(item.id) <= routeOrder.indexOf(currentRoute); return <button type="button" key={item.id} className={visibleStage === item.id ? 'active' : ''} disabled={!enabled} onClick={() => enabled && onStage(item.id)}><span>{item.label}</span></button>; })}</nav>}
    {error && <div className="creative-stage-error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}
    {videoAnalysisState === 'loading' && <section className="video-analysis-workspace"><header><div><LoaderCircle className="spin" size={18}/><div><b>视频拉片</b><span>正在读取拉片任务</span></div></div></header></section>}
    {videoAnalysisState === 'error' && <section className="video-analysis-workspace status-failed" role="alert"><header><div><CircleAlert size={18}/><div><b>拉片状态暂时无法读取</b><span>{videoAnalysisError}，页面会自动重新连接。</span></div></div></header></section>}
    {showVideoAnalysis && videoAnalyses[0] && <section className={`video-analysis-workspace status-${videoAnalyses[0].status.toLowerCase()}`}><header><div><Film size={18}/><div><b>视频拉片</b><span>{videoProgressLabel(videoAnalyses[0])}</span></div></div>{['ANALYZING', 'EXTRACTING_FRAMES'].includes(videoAnalyses[0].status) && <LoaderCircle className="spin" size={18}/>}</header>{videoAnalyses[0].error && <p>{videoAnalyses[0].error}</p>}{videoAnalyses[0].result && <><p>{videoAnalyses[0].result.summary}</p><div className="video-analysis-timeline">{videoAnalyses[0].result.narrativeStructure.map((segment) => <article key={`${segment.startSeconds}-${segment.segment}`}><time>{Math.round(segment.startSeconds)}s–{Math.round(segment.endSeconds)}s</time><div><b>{segment.segment}</b><span>{segment.content}</span><small>{segment.visual}</small></div></article>)}</div></>}</section>}
    {loadingDraft && visibleStage !== 'preparation' && <div className="creative-stage-loading"><LoaderCircle size={20}/><span>正在读取公众号母稿</span></div>}
    {!videoAnalysisInProgress && visibleStage === 'preparation' && <PreparationWorkspace project={project} onProjectChange={onProjectAccepted} onContinue={() => onStage('copy')} onOpenAgentSettings={onOpenAgentSettings} onOpenSearchSettings={onOpenSearchSettings}/>} 
    {visibleStage === 'copy' && wechatDraft && <CopyWorkspace project={project} draft={wechatDraft} brief={brief} briefState={briefState} skills={skills} accountVoices={accountVoices} onProjectChange={onProjectAccepted} onDraftChange={updateProjectDraft} onReloadDraft={loadWechatDraft} onSaveBrief={saveBrief} onContinue={() => onStage('visual')} onOpenModelSettings={onOpenModelSettings} onOpenAgentSettings={onOpenAgentSettings} onOpenVoiceSettings={onOpenVoiceSettings}/>}
    {visibleStage === 'visual' && wechatDraft && <VisualWorkspace project={project} draft={wechatDraft} onDraftChange={updateProjectDraft} onContinue={() => onStage('layout')} onOpenModelSettings={onOpenModelSettings}/>}
    {visibleStage === 'layout' && wechatDraft && <LayoutWorkspace
      draft={wechatDraft}
      onDraftChange={updateProjectDraft}
      onComplete={({ draft, version }) => { updateProjectDraft(draft); setCompletedVersion(version); onStage('drafts'); }}
      onEditCopy={() => onStage('copy')}
      onEditVisual={() => onStage('visual')}
    />}
    {visibleStage === 'drafts' && wechatDraft && (
      <DraftResultWorkspace
        draft={wechatDraft}
        version={completedVersion}
        derivedDrafts={projectDrafts.filter((item) => item.platform !== 'WECHAT')}
        activeDraftId={activeDerivedDraftId}
        onActiveDraftChange={onActiveDerivedDraftChange}
        onDraftChange={updateProjectDraft}
        onReloadDrafts={loadProjectDrafts}
        onPublish={onPublish}
        onOpenModelSettings={onOpenModelSettings}
        onEditCopy={() => onStage('copy')}
        onEditLayout={() => onStage('layout')}
      />
    )}
  </section>;
}
