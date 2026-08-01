import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, createScope, stagger } from 'animejs';
import { ArrowLeft, Bell, BrainCircuit, CalendarDays, ChartColumn, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, Compass, FilePenLine, FolderOpen, KeyRound, Lightbulb, Menu, PenLine, Pencil, Plus, RefreshCw, Search, Send, Settings, Trash2 } from 'lucide-react';
import { intelligenceKey, loadState, seedState, type FeishuLibraryTemplate, type LocalState, type WorkspaceProfile } from './data/localRepository';
import { webAgent, webAuth, webCreative, webIntelligence, webModels, webProjects, webSettings, webState, type CreateProjectInput, type CredentialStatus, type WebSession } from './data/webApi';
import { platformName, projectStageName, type ContentProject, type ContentVersion, type IntelligenceSource, type Platform } from './domain/content';
import { stageRouteForProjectStage } from './domain/creative-flow.mjs';
import { completedProjects, formatTodayTitle, projectTaskEntries } from './domain/today.mjs';
import type { ApiUsageLog, ApiUsageSummary, ApiUsageTask, ModelCapability, ModelCatalogItem, ModelConnection, ModelConnectionInput, ModelOperation, ModelProvider, ModelTask, ModelTaskPolicy } from './domain/integrations';
import { navigationGroups, readWorkspaceLocation, replaceWorkspaceLocation, resetViewport, type CreateStageRoute, type DiscoverSection, type ModelSection, type SearchPreset, type SettingsSection, type View } from './app/navigation.mjs';
import { PageHeader } from './components/workspace/PageHeader';
import { DiscoverWorkspace } from './workspaces/DiscoverWorkspace';
import { SettingsWorkspace } from './workspaces/SettingsWorkspace';
import { SourceSettings, type NewSourceInput } from './workspaces/settings/SourceSettings';
import { NetworkSearchPanel } from './workspaces/discover/NetworkSearchPanel';
import { LinkImportPanel } from './workspaces/discover/LinkImportPanel';
import { IntelligenceInbox } from './workspaces/discover/IntelligenceInbox';
import { WorkspaceProfileSettings } from './workspaces/settings/WorkspaceProfileSettings';
import { AccountAuthorizationSettings } from './workspaces/settings/AccountAuthorizationSettings';
import { AccountVoiceSettings } from './workspaces/settings/AccountVoiceSettings';
import { PromptTemplateSettings } from './workspaces/settings/PromptTemplateSettings';
import { CreateWorkspace } from './workspaces/create/CreateWorkspace';
import { CreativeProjectCenter } from './workspaces/create/CreativeProjectCenter';
import './styles.css';

function displayError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

function previewPublicLink(url: string) { return webIntelligence.previewLink(url); }
async function refreshRssSources(): Promise<{ items: LocalState['intelligence']; results: { sourceId: string; ok: boolean; count: number; error?: string }[]; sources?: LocalState['sources'] }> {
  return webIntelligence.refreshRss();
}
function webSearchStatus() { return webIntelligence.webSearchStatus(); }
function saveWebSearchKey(apiKey: string) { return webIntelligence.saveWebSearchKey(apiKey); }
function searchWeb(input: { query: string; category: string; domains: string[] }) { return webIntelligence.searchWeb(input); }

const navigationIcons: Record<View, typeof CalendarDays> = {
  today: CalendarDays,
  discover: Compass,
  create: PenLine,
  publish: Send,
  review: ChartColumn,
  assets: FolderOpen,
  settings: Settings,
};

function App() {
  const initialRoute = useRef(readWorkspaceLocation()).current;
  const [view, setView] = useState<View>(initialRoute.view);
  const [state, setState] = useState<LocalState>(seedState);
  const [selectedIntelId, setSelectedIntelId] = useState(initialRoute.intelligenceId ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState(initialRoute.projectId ?? '');
  const [activePlatform, setActivePlatform] = useState<Platform>(initialRoute.platform);
  const [createStage, setCreateStage] = useState<CreateStageRoute>(initialRoute.stage);
  const [creationRequested, setCreationRequested] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string }>({ status: 'idle', message: '' });
  const [searchPreset, setSearchPreset] = useState<SearchPreset | null>(null);
  const [discoverSection, setDiscoverSection] = useState<DiscoverSection>(initialRoute.discoverSection);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(initialRoute.settingsSection);
  const [requestedModelSection, setRequestedModelSection] = useState<ModelSection | null>(initialRoute.modelSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const preferenceSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const versionSaveQueues = useRef(new Map<string, Promise<unknown>>());

  const selectedIntel = state.intelligence.find((item) => item.id === selectedIntelId) ?? state.intelligence[0];
  const featuredProject = state.projects.find((item) => item.id === selectedProjectId);

  useLayoutEffect(() => {
    resetViewport();
  }, [view]);

  useEffect(() => {
    void loadState().then((loaded) => {
      setState(loaded);
      setSelectedIntelId((current) => loaded.intelligence.some((item) => item.id === current) ? current : loaded.intelligence[0]?.id ?? '');
      setSelectedProjectId((current) => {
        if (loaded.projects.some((item) => item.id === current)) return current;
        if (initialRoute.legacyTopicId) return loaded.projects.find((item) => item.legacyTopicId === initialRoute.legacyTopicId)?.id ?? '';
        return '';
      });
    }).catch((error) => {
      console.error('加载本地工作空间失败', error);
    }).finally(() => setIsLoaded(true));
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    replaceWorkspaceLocation({
      view,
      discoverSection,
      settingsSection,
      modelSection: requestedModelSection,
      intelligenceId: selectedIntelId || null,
      legacyTopicId: null,
      projectId: selectedProjectId || null,
      platform: activePlatform,
      stage: createStage,
    });
  }, [activePlatform, createStage, discoverSection, isLoaded, requestedModelSection, selectedIntelId, selectedProjectId, settingsSection, view]);

  const updateState = (next: LocalState) => {
    setState(next);
  };
  const savePreferences = (input: { workspace?: WorkspaceProfile; feishuTemplate?: FeishuLibraryTemplate }) => {
    preferenceSaveQueue.current = preferenceSaveQueue.current
      .catch(() => undefined)
      .then(() => webState.savePreferences(input))
      .catch((error) => { console.error('保存工作空间设置失败', error); });
  };
  const openDiscover = (section: DiscoverSection, preset: SearchPreset | null = null) => {
    setView('discover');
    setDiscoverSection(section);
    if (section === 'search') setSearchPreset(preset);
  };
  const openSettings = (section: SettingsSection, modelSection: ModelSection | null = null) => {
    setView('settings');
    setSettingsSection(section);
    setRequestedModelSection(section === 'models' ? modelSection : null);
  };
  const completeSetup = (workspace: WorkspaceProfile) => {
    const saved = { ...workspace, setupCompleted: true };
    updateState({ ...state, workspace: saved });
    savePreferences({ workspace: saved });
  };
  const openProject = (project: ContentProject) => {
    setSelectedProjectId(project.id);
    setActivePlatform(project.planning.targetPlatforms[0] ?? project.versions[0]?.platform ?? 'WECHAT');
    setCreateStage(stageRouteForProjectStage(project.stage));
    setView('create');
  };
  const createProject = async (input: CreateProjectInput) => {
    const result = await webProjects.create(input);
    setState((current) => ({ ...current, projects: [result.project, ...current.projects.filter((project) => project.id !== result.project.id)] }));
    return result.project;
  };
  const addIntelligenceToCreative = async (itemId: string, _analysis?: LocalState['intelligence'][number]['analysis'], angleIndex = 0) => {
    const result = await webProjects.fromIntelligence(itemId, { angleIndex });
    setState((current) => ({ ...current, projects: [result.project, ...current.projects.filter((project) => project.id !== result.project.id)] }));
    openProject(result.project);
  };
  const openIntelligenceProject = (projectId: string) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (project) openProject(project);
  };
  const requestNewCreation = () => {
    setSelectedProjectId('');
    setCreateStage('planning');
    setCreationRequested(true);
    setView('create');
  };
  const saveContentVersion = (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => {
    const updatedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id !== projectId ? project : {
        ...project,
        status: project.status === 'BRIEF' ? 'WRITING' : project.status,
        updatedAt,
        versions: project.versions.map((version) => version.id === versionId ? { ...version, ...patch, updatedAt } : version),
      }),
    }));
    const key = `${projectId}:${versionId}`;
    const previous = versionSaveQueues.current.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => webCreative.updateVersion(projectId, versionId, patch)).then((result) => {
      setState((current) => ({ ...current, projects: current.projects.map((project) => project.id === result.project.id ? result.project : project) }));
    }).catch((error) => { console.error('保存平台正文失败', error); });
    versionSaveQueues.current.set(key, pending);
    void pending.finally(() => { if (versionSaveQueues.current.get(key) === pending) versionSaveQueues.current.delete(key); });
  };
  const acceptProjectFromServer = (acceptedProject: ContentProject) => {
    setState((current) => ({ ...current, projects: current.projects.map((project) => project.id === acceptedProject.id ? acceptedProject : project) }));
  };
  const refreshRss = async () => {
    if (state.sources.filter((source) => source.enabled).length === 0) {
      setRefreshFeedback({ status: 'error', message: '尚未启用资讯来源，请先完成配置。' });
      openSettings('sources');
      return;
    }
    setRefreshFeedback({ status: 'running', message: '正在读取已启用的情报源…' });
    try {
      const result = await refreshRssSources();
      const refreshedSourceNames = new Set(state.sources.filter((source) => result.results.some((status) => status.sourceId === source.id && status.ok)).map((source) => source.name));
      const retained = state.intelligence.filter((item) => item.captureMethod === 'MANUAL_LINK' || (item.captureMethod === 'RSS' && !refreshedSourceNames.has(item.source)));
      const existingKeys = new Set(retained.map(intelligenceKey));
      const received = result.items.filter((item) => !existingKeys.has(intelligenceKey(item)));
      const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      updateState({ ...state, intelligence: [...received, ...retained], sources: result.sources ?? state.sources.map((source) => {
        const status = result.results.find((item) => item.sourceId === source.id);
        return !status ? source : { ...source, lastSyncedAt: status.ok ? now : source.lastSyncedAt, lastError: status.ok ? undefined : status.error };
      }) });
      const failedCount = result.results.filter((item) => !item.ok).length;
      if (received[0]) setSelectedIntelId(received[0].id);
      setRefreshFeedback(received.length > 0 ? { status: 'success', message: `已发现 ${received.length} 条新热点${failedCount ? `，${failedCount} 个来源失败` : ''}` } : { status: 'empty', message: failedCount ? `${failedCount} 个来源刷新失败，请在设置中查看原因` : '本次没有发现新热点，已有内容未重复加入。' });
    } catch (error) {
      setRefreshFeedback({ status: 'error', message: error instanceof Error ? error.message : '刷新热点失败。' });
    }
  };
  const addSource = async (source: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>) => {
    const saved = await webIntelligence.createSources([source]);
    updateState({ ...state, sources: [...state.sources, ...saved] });
  };
  const addSources = async (sources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[]) => {
    const saved = await webIntelligence.createSources(sources);
    const existingIds = new Set(state.sources.map((source) => source.id));
    updateState({ ...state, sources: [...state.sources, ...saved.filter((source) => !existingIds.has(source.id))] });
  };
  const updateSource = async (sourceId: string, source: NewSourceInput) => {
    const saved = await webIntelligence.updateSource(sourceId, source);
    updateState({ ...state, sources: state.sources.map((item) => item.id === sourceId ? saved : item) });
  };
  const saveAnalysis = (itemId: string, analysis: NonNullable<LocalState['intelligence'][number]['analysis']>) => updateState({ ...state, intelligence: state.intelligence.map((item) => item.id === itemId ? { ...item, analysis } : item) });
  const removeSource = async (sourceId: string) => {
    await webIntelligence.removeSource(sourceId);
    updateState({ ...state, sources: state.sources.filter((source) => source.id !== sourceId) });
  };
  const saveFeishuTemplate = (feishuTemplate: FeishuLibraryTemplate) => {
    setState((current) => ({ ...current, feishuTemplate }));
    savePreferences({ feishuTemplate });
  };
  const saveClippedLink = async (item: Omit<LocalState['intelligence'][number], 'id'>) => {
    const { analysis: _analysis, ...payload } = item;
    const saved = await webIntelligence.saveItem(payload);
    setState((current) => ({
      ...current,
      intelligence: [saved, ...current.intelligence.filter((existing) => existing.id !== saved.id && intelligenceKey(existing) !== intelligenceKey(saved))],
    }));
    setSelectedIntelId(saved.id);
    openDiscover('inbox');
  };
  const saveSearchCandidate = async (item: LocalState['intelligence'][number]) => {
    if (state.intelligence.some((current) => intelligenceKey(current) === intelligenceKey(item))) return;
    const { id: _id, analysis: _analysis, ...payload } = item;
    const saved = await webIntelligence.saveItem(payload);
    setState((current) => ({
      ...current,
      intelligence: [saved, ...current.intelligence.filter((existing) => existing.id !== saved.id && intelligenceKey(existing) !== intelligenceKey(saved))],
    }));
  };
  if (!isLoaded) return <div className="boot-screen"><div className="boot-mark">内容引擎</div><p>正在准备你的编辑部……</p></div>;
  if (!state.workspace.setupCompleted) return <Onboarding initial={state.workspace} onComplete={completeSetup} />;

  return <div className="app-shell">
    <header className="topbar">
      <button className="mobile-menu-button" type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
      <div className="wordmark">知行<span>内容</span>实验室</div>
      <label className="global-search"><Search size={17}/><input placeholder="搜索热点、项目、内容、素材" /></label>
      <div className="top-actions"><button className="button primary" onClick={requestNewCreation}><Plus size={16}/>新建创作</button><button className="icon-button" aria-label="通知"><Bell size={20}/></button><button className="icon-button" aria-label="同步"><RefreshCw size={20}/></button><span className="avatar" /></div>
    </header>
    <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
      <nav className="primary-navigation" aria-label="主导航">{navigationGroups.map((group) => <section className="nav-group" key={group.id}><div className="nav-group-label">{group.label}</div>{group.items.map(({ view: target, label }) => { const Icon = navigationIcons[target]; return <button key={target} className={`nav-item ${view === target ? 'active' : ''}`} aria-current={view === target ? 'page' : undefined} onClick={() => { if (target === 'create') { setSelectedProjectId(''); setCreateStage('planning'); } setView(target); setSidebarOpen(false); }}><Icon size={19}/><span>{label}</span></button>; })}</section>)}</nav>
    </aside>
    {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />}
    <main className="main-content">
      {view === 'today' && <Today onNavigate={setView} projects={state.projects} intelligence={state.intelligence} onOpenProject={(id) => { const project = state.projects.find((item) => item.id === id); if (project) openProject(project); }} />}
      {view === 'discover' && <DiscoverWorkspace section={discoverSection} onSectionChange={setDiscoverSection} inbox={<IntelligenceInbox item={selectedIntel} intelligence={state.intelligence} sources={state.sources} projects={state.projects} defaultPlatforms={state.workspace.enabledPlatforms} onSelect={setSelectedIntelId} onAddToCreative={(itemId, analysis, angleIndex) => void addIntelligenceToCreative(itemId, analysis, angleIndex)} onOpenProject={openIntelligenceProject} onSaveAnalysis={saveAnalysis} onRefresh={refreshRss} onOpenSources={() => openSettings('sources')} refreshFeedback={refreshFeedback} />} search={<NetworkSearchPanel preset={searchPreset} onSave={saveSearchCandidate} onOpenSearchSettings={() => openSettings('models', 'search')} checkStatus={webSearchStatus} searchWeb={searchWeb} />} linkImport={<LinkImportPanel onSave={saveClippedLink} onShowInbox={() => openDiscover('inbox')} previewLink={previewPublicLink} />} />}
      {view === 'create' && (!selectedProjectId || !featuredProject) && <CreativeProjectCenter projects={state.projects} onOpenProject={openProject} onCreateProject={createProject} creationRequested={creationRequested} onCreationHandled={() => setCreationRequested(false)} />}
      {view === 'create' && selectedProjectId && featuredProject && <CreateWorkspace project={featuredProject} stage={createStage} onStage={setCreateStage} onExitProject={() => { setSelectedProjectId(''); setCreateStage('planning'); }} activePlatform={activePlatform} onPlatform={setActivePlatform} onSaveVersion={saveContentVersion} onProjectAccepted={acceptProjectFromServer} onOpenModelSettings={() => openSettings('models', 'policies')} onOpenAgentSettings={() => openSettings('models', 'agent')} onOpenSearchSettings={() => openSettings('models', 'search')} onOpenVoiceSettings={() => openSettings('voices')} />}
      {view === 'publish' && <Publish project={featuredProject} onNavigate={setView} />}
      {view === 'review' && <Review projects={state.projects} onOpenProject={(project) => openProject(project)} />}
      {view === 'assets' && <Utility title="素材库" description="素材将按目录、类型和所属项目统一管理。" />}
      {view === 'settings' && <SettingsWorkspace section={settingsSection} onSectionChange={setSettingsSection} workspace={<WorkspaceProfileSettings workspace={state.workspace} onChange={(workspace) => { setState((current) => ({ ...current, workspace })); savePreferences({ workspace }); }} />} sources={<SourceSettings sources={state.sources} onAddSource={addSource} onAddSources={addSources} onUpdateSource={updateSource} onRemoveSource={removeSource} />} voices={<AccountVoiceSettings />} models={<ModelSettingsScreen initialSection={requestedModelSection} onSectionChange={setRequestedModelSection} />} feishu={<WorkspaceSettings template={state.feishuTemplate} onTemplateChange={saveFeishuTemplate} />} accounts={<AccountAuthorizationSettings />} />}
    </main>
  </div>;
}

function Onboarding({ initial, onComplete }: { initial: WorkspaceProfile; onComplete: (workspace: WorkspaceProfile) => void }) {
  const [name, setName] = useState(initial.name);
  const [topics, setTopics] = useState(initial.primaryTopics.join('、'));
  const [platforms, setPlatforms] = useState<Platform[]>(initial.enabledPlatforms);
  const togglePlatform = (platform: Platform) => setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || platforms.length === 0) return;
    onComplete({
      name: name.trim(),
      materialRoot: initial.materialRoot,
      primaryTopics: topics.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
      enabledPlatforms: platforms,
      setupCompleted: true,
    });
  };
  return <main className="onboarding-shell">
    <section className="onboarding-poster"><div className="poster-stamp">NO.01</div><div><span>CONTENT ENGINE</span><h1>把灵感，<br/>变成稳定产出。</h1></div><p>先设置你的内容工作室。后续热点、素材与草稿都将在这里统一管理。</p><div className="poster-dots">● ● ●</div></section>
    <form className="onboarding-form" onSubmit={submit}>
      <div className="eyebrow">FIRST RUN / 首次设置</div><h2>建立你的编辑部</h2><p>只需一分钟；飞书、模型和账号授权都可以稍后连接。</p>
      <label>工作空间名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：知行内容实验室" autoFocus /></label>
      <label>你最常做的题材<input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="例如：AI 工具、国学、财经" /><small>用顿号或逗号分隔，之后可随时调整。</small></label>
      <fieldset><legend>首发平台</legend><div className="platform-options">{(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'] as Platform[]).map((platform) => <button type="button" key={platform} className={platforms.includes(platform) ? 'chosen' : ''} onClick={() => togglePlatform(platform)}>{platforms.includes(platform) ? '✓ ' : '+ '}{platformName[platform]}</button>)}</div></fieldset>
      <button className="button primary setup-submit" type="submit" disabled={!name.trim() || platforms.length === 0}>进入内容引擎 <ChevronRight size={17}/></button>
    </form>
  </main>;
}

function Today({ onNavigate, projects, intelligence, onOpenProject }: { onNavigate: (view: View) => void; projects: ContentProject[]; intelligence: LocalState['intelligence']; onOpenProject: (id: string) => void }) {
  const projectTasks = projectTaskEntries(projects).map((task) => ({ ...task, onClick: () => onOpenProject(task.projectId) }));
  const tasks = projectTasks.slice(0, 6);
  const scheduledProjects = projects.filter((project) => project.planning.plannedPublishAt).slice(0, 4);
  return <>
  <PageHeader eyebrow="TODAY / 行动中心" title={formatTodayTitle()} subtitle={tasks.length ? `你有 ${tasks.length} 件内容工作需要处理。` : '今天没有需要立即处理的内容工作。'} />
  <div className="today-layout"><div>
    <section className="panel"><div className="panel-head"><h2>▣ 今日优先事项</h2><span className="chip mint">{tasks.length} 待办</span></div><div className="task-list">{tasks.length ? tasks.map((task) => <Task key={task.id} title={task.title} sub={task.sub} action={task.action} onClick={task.onClick} />) : <div className="today-empty">暂无待处理工作</div>}</div></section>
    <div className="editorial-rule compact" /><section className="panel"><div className="panel-head"><h2>✎ 进行中的内容项目</h2><button className="text-button" onClick={() => onNavigate('create')}>查看全部</button></div>{projects.length ? <div className="project-grid">{projects.slice(0,2).map((project) => <article className="project-card" key={project.id}><span className="chip yellow">{projectStageName[project.stage]}</span><h3>{project.title}</h3><p>{project.planning.coreMessage || project.coreViewpoint}</p><footer><span>更新于 {project.updatedAt}</span><button className="text-button" onClick={() => onOpenProject(project.id)}>继续编辑</button></footer></article>)}</div> : <div className="today-empty">暂无进行中的内容项目</div>}</section>
  </div><aside className="today-aside"><section className="hot-card"><h2>♨ 今日热点</h2>{intelligence.slice(0,8).map((item) => <div key={item.id}><small>#{item.category}</small><strong>{item.title}</strong></div>)}{!intelligence.length && <p>暂无热点资讯</p>}<button className="text-button inverted" onClick={() => onNavigate('discover')}>前往发现中心 →</button></section><section className="schedule-card"><h2>▣ 近期排期</h2>{scheduledProjects.length ? scheduledProjects.map((project) => <p key={project.id}><b>{project.planning.plannedPublishAt}</b><br/>{project.title}<br/>平台：{project.planning.targetPlatforms.map((platform) => platformName[platform]).join('、')}</p>) : <p>暂无已安排项目</p>}</section></aside></div>
  </>; }

function Task({ title, sub, action, onClick }: { title: string; sub: string; action: string; onClick: () => void }) { return <article className="task"><span className="checkbox"/><div><b>{title}</b><small>{sub}</small></div><button className="text-button" onClick={onClick}>{action}</button></article>; }





function Publish({ project, onNavigate }: { project: ContentProject | undefined; onNavigate: (view: View) => void }) { return <>
  <PageHeader eyebrow="PUBLISH / 发布中心" title="内容日历" subtitle="先安排发布时间，再进入独立的发布审核。" />
  <div className="publish-layout"><section><div className="filter-row slim"><div><button className="filter active">本周</button><button className="filter">公众号</button><button className="filter">小红书</button><button className="filter">视频号</button></div></div><div className="calendar-grid">{['周一 21','周二 22','周三 23','周四 24','周五 25','周六 26','周日 27'].map((day,index) => <div className="calendar-day" key={day}><b>{day}</b>{index === 1 && <div className="calendar-post">小红书：Notion AI 教程下集</div>}{index === 2 && <div className="calendar-post red">待审核：{project?.title}</div>}{index === 4 && <div className="calendar-post mint">公众号：AIGC 行业周报</div>}</div>)}</div></section><aside className="publish-review"><span className="chip yellow">待发布审核</span><h2>{project?.title}</h2><img src="https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80" alt="发布封面预览"/><p><b>小红书 · 图文 8 页</b><br/><small>计划：7 月 23 日 18:30</small></p><ul><li><CheckCircle2 size={16}/>标题与封面已确认</li><li><CheckCircle2 size={16}/>图片比例符合平台要求</li><li className="pending">! 有 1 条事实待确认</li></ul><button className="button primary wide" onClick={() => onNavigate('create')}>进入发布审核 →</button></aside></div>
  </>; }

function Review({ projects, onOpenProject }: { projects: ContentProject[]; onOpenProject: (project: ContentProject) => void }) {
  const reviewable = completedProjects(projects);
  return <>
    <PageHeader title="内容复盘" subtitle={reviewable.length ? `${reviewable.length} 个已完成项目等待回填数据。` : undefined} />
    {reviewable.length ? <section className="review-project-grid">{reviewable.map((project) => <article key={project.id}><header><span>{project.planning.category || '未分类'}</span><time>{project.updatedAt}</time></header><h2>{project.title}</h2><div>{[...new Set(project.versions.map((version) => version.platform))].map((platform) => <span key={platform}>{platformName[platform]}</span>)}</div><footer><button className="text-button" type="button" onClick={() => onOpenProject(project)}>查看项目</button></footer></article>)}</section> : <section className="review-empty-state"><ChartColumn size={28}/><h2>还没有可复盘的内容</h2><p>完成审核与发布后，项目会进入这里。</p></section>}
  </>;
}

const modelProviders: { provider: ModelProvider; label: string; detail: string; baseUrl: string; model: string }[] = [
  { provider: 'DASHSCOPE', label: '阿里云百炼', detail: '通义千问兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { provider: 'SILICONFLOW', label: '硅基流动', detail: '模型聚合与推理服务', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B' },
  { provider: 'VOLCENGINE_ARK', label: '火山方舟', detail: '填写你的接入点模型 ID', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '你的接入点 ID' },
  { provider: 'KIMI', label: 'Kimi', detail: 'Moonshot AI 接口', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { provider: 'ZHIPU', label: '智谱 AI', detail: 'GLM 系列兼容接口', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { provider: 'OPENAI', label: 'OpenAI', detail: '官方 API', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { provider: 'OPENAI_COMPATIBLE', label: '自定义兼容接口', detail: '适用于 OpenAI 兼容服务', baseUrl: 'https://api.example.com/v1', model: '填写模型名称' },
];

type ModelDraft = {
  id?: string;
  provider: ModelProvider;
  label: string;
  baseUrl: string;
  model: string;
  purposes: ModelConnection['purposes'];
  apiKey: string;
};

function draftForProvider(provider: ModelProvider): ModelDraft {
  const preset = modelProviders.find((item) => item.provider === provider) ?? modelProviders[0];
  return { provider, label: preset.label, baseUrl: preset.baseUrl, model: preset.model, purposes: ['INTELLIGENCE_SUMMARY', 'INTELLIGENCE_FILTER', 'TOPIC_RECOMMENDATION'], apiKey: '' };
}


const externalModelProviders = modelProviders.filter((provider) => provider.provider !== 'DASHSCOPE');
const providerLabels: Record<ModelProvider, string> = { DASHSCOPE: '阿里云百炼', SILICONFLOW: '硅基流动', VOLCENGINE_ARK: '火山方舟', KIMI: 'Kimi', ZHIPU: '智谱 AI', OPENAI: 'OpenAI', OPENAI_COMPATIBLE: '自定义兼容接口' };
const modelTaskNames: Record<ModelTask, string> = {
  INTELLIGENCE_ANALYSIS: '热点分析',
  SOURCE_VERIFICATION: '事实核验',
  TOPIC_RECOMMENDATION: '选题建议',
  VOICE_CALIBRATION: '账号声音提炼',
  CONTENT_WRITING: '文案生成',
  CONTENT_REWRITE: '改写与解读',
  CONTENT_LAYOUT: '公众号排版',
  VISUAL_PLANNING: '配图策划',
  TEXT_TO_IMAGE: '文生图',
  IMAGE_TO_IMAGE: '图生图 / 图片编辑',
  SPEECH_SYNTHESIS: '配音与口播',
  SPEECH_RECOGNITION: '语音识别',
  TEXT_TO_VIDEO: '文生视频',
  IMAGE_TO_VIDEO: '首帧图生视频',
  FIRST_LAST_FRAME_TO_VIDEO: '首尾帧生视频',
  REFERENCE_TO_VIDEO: '参考图 / 视频生成',
  VIDEO_EDIT: '视频编辑',
};
const usageTaskNames: Record<ApiUsageTask, string> = { ...modelTaskNames, SOURCE_DISCOVERY: '研究资料检索' };

type ModelSettingsSection = ModelSection;

const modelSettingsScreenTitles: Record<ModelSettingsSection, string> = {
  bailian: '百炼',
  agent: '核心 Agent',
  search: '检索 API',
  connections: '外部 API',
  policies: '任务策略',
  templates: '提示词模板',
  usage: '调用记录',
};

function ModelSettingsScreen({ initialSection = null, onSectionChange }: { initialSection?: ModelSettingsSection | null; onSectionChange: (section: ModelSettingsSection) => void }) {
  const [screen, setScreen] = useState<ModelSettingsSection | 'editor'>('bailian');
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogItem[]>([]);
  const [policies, setPolicies] = useState<ModelTaskPolicy[]>([]);
  const [usage, setUsage] = useState<ApiUsageSummary>({ totalCalls: 0, todayCalls: 0, successCalls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0 });
  const [logs, setLogs] = useState<ApiUsageLog[]>([]);
  const [editing, setEditing] = useState<ModelConnection | undefined>();
  const [notice, setNotice] = useState<{ screen: ModelSettingsSection; type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (initialSection) setScreen(initialSection);
  }, [initialSection]);

  const loadConnections = () => {
    void webModels.connections().then(setConnections).catch((error) => {
      setNotice({ screen: 'connections', type: 'error', text: displayError(error, '读取外部 API 连接失败。') });
    });
  };
  const loadCatalog = () => {
    void webModels.catalog().then(setCatalog).catch(() => undefined);
  };
  const loadPolicies = () => {
    void webModels.taskPolicies().then(setPolicies).catch((error) => {
      setNotice({ screen: 'policies', type: 'error', text: displayError(error, '读取任务策略失败。') });
    });
  };
  const loadUsage = () => {
    void webModels.usage().then((result) => {
      setUsage(result.summary);
      setLogs(result.logs);
    }).catch((error) => {
      setNotice({ screen: 'usage', type: 'error', text: displayError(error, '读取调用记录失败。') });
    });
  };
  const refreshModelSettings = () => {
    loadConnections();
    loadCatalog();
    loadPolicies();
  };

  useEffect(() => {
    refreshModelSettings();
  }, []);

  useEffect(() => {
    if (screen === 'usage') loadUsage();
  }, [screen]);

  const syncCatalog = async () => {
    setNotice(null);
    try {
      const result = await webModels.syncCatalog();
      setCatalog(result.items);
      setNotice(result.errors[0]
        ? { screen: 'policies', type: 'error', text: result.errors[0].message }
        : { screen: 'policies', type: 'success', text: `已同步 ${result.items.length} 个可选模型。` });
    } catch (error) {
      setNotice({ screen: 'policies', type: 'error', text: displayError(error, '同步模型目录失败。') });
    }
  };
  const saveExternal = async (input: ModelConnectionInput) => {
    const saved = input.id
      ? await webModels.updateConnection(input.id, input)
      : await webModels.createConnection(input);
    setConnections((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  };
  const testExternal = async (input: ModelConnectionInput) => {
    const saved = await saveExternal(input);
    const tested = await webModels.testConnection(saved.id);
    setConnections((current) => [tested, ...current.filter((item) => item.id !== tested.id)]);
    return tested;
  };
  const removeExternal = async (connection: ModelConnection) => {
    if (!window.confirm(`确定移除“${connection.label}”吗？服务端保存的 API Key 也会一并删除。`)) return;
    await webModels.removeConnection(connection.id);
    setConnections((current) => current.filter((item) => item.id !== connection.id));
    refreshModelSettings();
  };
  const savePolicy = async (policy: ModelTaskPolicy) => {
    const saved = await webModels.saveTaskPolicy(policy);
    setPolicies((current) => [saved, ...current.filter((item) => item.task !== saved.task)]);
  };
  const openSection = (next: ModelSettingsSection) => {
    setNotice(null);
    setScreen(next);
    onSectionChange(next);
  };
  const renderSection = () => {
    if (screen === 'bailian') return <BailianCredentialSettings onChanged={refreshModelSettings} />;
    if (screen === 'agent') return <CoreAgentSettings catalog={catalog} onSynced={refreshModelSettings} />;
    if (screen === 'search') return <WebSearchSettings embedded onChanged={refreshModelSettings} />;
    if (screen === 'connections') return <ExternalApiConnections connections={connections} onNew={() => { setEditing(undefined); setNotice(null); setScreen('editor'); }} onEdit={(connection) => { setEditing(connection); setNotice(null); setScreen('editor'); }} onRemove={removeExternal} />;
    if (screen === 'policies') return <TaskPolicyScreen catalog={catalog} policies={policies} onSync={() => void syncCatalog()} onSave={savePolicy} />;
    if (screen === 'templates') return <PromptTemplateSettings />;
    return <UsageLogScreen logs={logs} />;
  };

  if (screen === 'editor') {
    return <ExternalApiEditor key={editing?.id ?? 'new'} connection={editing} onBack={() => setScreen('connections')} onSave={saveExternal} onTest={testExternal} />;
  }

  return <div className="ai-settings">
    <PageHeader eyebrow="SETTINGS / 模型与 API" title={modelSettingsScreenTitles[screen]} />
    <nav className="ai-section-nav" aria-label="模型与 API 分区">
      <button className={screen === 'bailian' ? 'active' : ''} onClick={() => openSection('bailian')}><BrainCircuit size={18}/>百炼</button>
      <button className={screen === 'agent' ? 'active' : ''} onClick={() => openSection('agent')}><BrainCircuit size={18}/>核心 Agent</button>
      <button className={screen === 'search' ? 'active' : ''} onClick={() => openSection('search')}><Search size={18}/>检索 API</button>
      <button className={screen === 'connections' ? 'active' : ''} onClick={() => openSection('connections')}><KeyRound size={18}/>外部 API <span>{connections.length}</span></button>
      <button className={screen === 'policies' ? 'active' : ''} onClick={() => openSection('policies')}><Settings size={18}/>任务策略</button>
      <button className={screen === 'templates' ? 'active' : ''} onClick={() => openSection('templates')}><FilePenLine size={18}/>提示词模板</button>
      <button className={screen === 'usage' ? 'active' : ''} onClick={() => openSection('usage')}><ChartColumn size={18}/>调用记录</button>
    </nav>
    <div className={`ai-section-content ai-section-content-${screen}`}>
      {notice?.screen === screen && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}
      {screen === 'usage' && <UsageOverview usage={usage} />}
      {renderSection()}
    </div>
  </div>;
}

function UsageOverview({ usage }: { usage: ApiUsageSummary }) {
  return <section className="usage-overview"><div><small>今日调用</small><b>{usage.todayCalls}</b></div><div><small>累计调用</small><b>{usage.totalCalls}</b></div><div><small>成功 / 失败</small><b>{usage.successCalls} / {usage.failedCalls}</b></div><div><small>输入 / 输出 Token</small><b>{usage.inputTokens} / {usage.outputTokens}</b></div></section>;
}


const taskRequirements: Record<ModelTask, { capability: ModelCapability; operation?: ModelOperation; flow: string }> = {
  INTELLIGENCE_ANALYSIS: { capability: 'TEXT', flow: '资讯 → 分析结果' }, SOURCE_VERIFICATION: { capability: 'TEXT', flow: '研究来源 → 事实结论' }, TOPIC_RECOMMENDATION: { capability: 'TEXT', flow: '资讯 → 选题' }, VOICE_CALIBRATION: { capability: 'TEXT', flow: '授权文章 → 表达规则' }, CONTENT_WRITING: { capability: 'TEXT', flow: '素材 → 文案' }, CONTENT_REWRITE: { capability: 'TEXT', flow: '原文 → 改写' }, CONTENT_LAYOUT: { capability: 'TEXT', flow: '正文 → 排版稿' }, VISUAL_PLANNING: { capability: 'TEXT', flow: '正文 → 配图方案' },
  TEXT_TO_IMAGE: { capability: 'IMAGE', operation: 'TEXT_TO_IMAGE', flow: '文本 → 图片' }, IMAGE_TO_IMAGE: { capability: 'IMAGE', operation: 'IMAGE_TO_IMAGE', flow: '图片 + 文本 → 图片' }, SPEECH_SYNTHESIS: { capability: 'AUDIO', flow: '文本 → 音频' }, SPEECH_RECOGNITION: { capability: 'ASR', flow: '音频 / 视频 → 文本' },
  TEXT_TO_VIDEO: { capability: 'VIDEO', operation: 'TEXT_TO_VIDEO', flow: '文本 → 视频' }, IMAGE_TO_VIDEO: { capability: 'VIDEO', operation: 'IMAGE_TO_VIDEO', flow: '首帧 + 文本 → 视频' }, FIRST_LAST_FRAME_TO_VIDEO: { capability: 'VIDEO', operation: 'FIRST_LAST_FRAME_TO_VIDEO', flow: '首帧 + 尾帧 + 文本 → 视频' }, REFERENCE_TO_VIDEO: { capability: 'VIDEO', operation: 'REFERENCE_TO_VIDEO', flow: '参考图 / 视频 + 文本 → 视频' }, VIDEO_EDIT: { capability: 'VIDEO', operation: 'VIDEO_EDIT', flow: '视频 + 指令 → 视频' },
};
const modelTaskGroups: { label: string; tasks: ModelTask[] }[] = [
  { label: '情报与内容', tasks: ['INTELLIGENCE_ANALYSIS', 'SOURCE_VERIFICATION', 'TOPIC_RECOMMENDATION', 'VOICE_CALIBRATION', 'CONTENT_WRITING', 'CONTENT_REWRITE', 'CONTENT_LAYOUT', 'VISUAL_PLANNING'] },
  { label: '图片', tasks: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'] },
  { label: '音频', tasks: ['SPEECH_SYNTHESIS', 'SPEECH_RECOGNITION'] },
  { label: '视频', tasks: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO', 'FIRST_LAST_FRAME_TO_VIDEO', 'REFERENCE_TO_VIDEO', 'VIDEO_EDIT'] },
];

function modelSupportsTask(item: ModelCatalogItem, task: ModelTask) {
  const requirement = taskRequirements[task];
  return requirement.operation ? (item.operations ?? inferModelOperations(item.model)).includes(requirement.operation) : item.capabilities.includes(requirement.capability);
}

function inferModelOperations(model: string): ModelOperation[] {
  const value = model.toLowerCase();
  if (/video-?edit|videoedit/.test(value)) return ['VIDEO_EDIT'];
  if (/first.*last|last.*frame|kf2v|flf2v/.test(value)) return ['FIRST_LAST_FRAME_TO_VIDEO'];
  if (/r2v|reference.*video/.test(value)) return ['REFERENCE_TO_VIDEO'];
  if (/i2v|image.*video/.test(value)) return ['IMAGE_TO_VIDEO'];
  if (/t2v|text.*video/.test(value)) return ['TEXT_TO_VIDEO'];
  if (/image-edit|edit-image/.test(value)) return ['IMAGE_TO_IMAGE'];
  if (/qwen-image-(2\.0|2\.0-pro|max)|wan2\.7-image/.test(value)) return ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'];
  if (/image|t2i|flux|z-image|cogview|stable-diffusion|sdxl/.test(value)) return ['TEXT_TO_IMAGE'];
  return [];
}

function modelSourceKey(item: ModelCatalogItem) {
  if (item.provider === 'EXTERNAL_API') return `external:${item.connectionId}`;
  return item.origin ?? 'ACCOUNT_CATALOG';
}

function modelSourceName(item: ModelCatalogItem) {
  if (item.provider === 'EXTERNAL_API') return item.connectionLabel;
  if (item.origin === 'CLI_MEDIA') return 'CLI 媒体能力';
  if (item.origin === 'MARKET_CATALOG') return '百炼模型市场';
  return '百炼账户目录';
}

function TaskPolicyScreen({ catalog, policies, onSync, onSave }: { catalog: ModelCatalogItem[]; policies: ModelTaskPolicy[]; onSync: () => void; onSave: (policy: ModelTaskPolicy) => Promise<void> }) {
  const tasks = Object.keys(modelTaskNames) as ModelTask[];
  const [task, setTask] = useState<ModelTask>('INTELLIGENCE_ANALYSIS');
  const [source, setSource] = useState('ALL');
  const [selection, setSelection] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const requirement = taskRequirements[task];
  const policy = policies.find((item) => item.task === task);
  const savedSelection = catalog.find((item) => item.provider === policy?.provider && item.connectionId === policy?.connectionId && item.model === policy?.model)?.id ?? '';
  const effectiveSelection = selection ?? savedSelection;
  const taskModels = catalog.filter((item) => modelSupportsTask(item, task));
  const sourceOptions = [...new Map(taskModels.map((item) => [modelSourceKey(item), modelSourceName(item)])).entries()];
  const filtered = taskModels.filter((item) => source === 'ALL' || modelSourceKey(item) === source);
  const selectedModel = catalog.find((item) => item.id === effectiveSelection);
  const selectTask = (next: ModelTask) => { setTask(next); setSource('ALL'); setSelection(undefined); };
  const save = async () => {
    setBusy(true);
    try {
      const selected = catalog.find((item) => item.id === effectiveSelection);
      await onSave(selected ? { task, provider: selected.provider, connectionId: selected.connectionId, model: selected.model } : { task });
    } finally { setBusy(false); }
  };
  return <section className="policy-split"><aside className="policy-task-list"><header><b>功能任务</b><span>{tasks.filter((item) => policies.find((policy) => policy.task === item)?.model).length}/{tasks.length}</span></header>{modelTaskGroups.map((group) => <div className="policy-task-group" key={group.label}><small>{group.label}</small>{group.tasks.map((item) => { const configured = policies.find((policy) => policy.task === item)?.model; return <button type="button" key={item} className={task === item ? 'active' : ''} onClick={() => selectTask(item)}><span>{modelTaskNames[item]}</span><em>{configured ?? '未配置'}</em></button>; })}</div>)}</aside><section className="policy-selector"><header><div><span className="eyebrow">TASK ROUTING</span><h2>{modelTaskNames[task]}</h2></div><span className="capability-badge">{requirement.flow}</span></header><div className="policy-fields"><label><span>模型来源</span><select value={source} onChange={(event) => { setSource(event.target.value); setSelection(undefined); }}><option value="ALL">全部来源</option>{sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="policy-model-field"><span>执行模型 <em>{filtered.length} 个可选</em></span><select value={effectiveSelection} onChange={(event) => setSelection(event.target.value)}><option value="">不调用模型</option>{filtered.map((item) => <option key={item.id} value={item.id}>{item.model} · {modelSourceName(item)}</option>)}</select></label></div><div className="policy-selection">{requirement.operation && <span className="policy-operation">{modelTaskNames[task]}</span>}{selectedModel ? <div className="selected-model-summary"><span className="connection-status ready"/><div><b>{selectedModel.model}</b><small>{modelSourceName(selectedModel)}</small></div></div> : <div className="selected-model-summary empty"><CircleAlert size={16}/><span>{taskModels.length ? '尚未选择模型' : '当前目录没有支持该任务的模型'}</span></div>}</div><footer><button className="button" type="button" onClick={onSync}><RefreshCw size={16}/>同步模型</button><button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中' : '保存策略'}</button></footer></section></section>;
}

function UsageLogScreen({ logs }: { logs: ApiUsageLog[] }) {
  return <section className="usage-log"><div className="panel-head"><h2>调用记录</h2><span className="chip">最近 80 条</span></div>{logs.length === 0 ? <p>尚无 API 调用。</p> : <table><thead><tr><th>时间</th><th>功能</th><th>服务</th><th>结果</th><th>Token</th><th>耗时</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Date(log.startedAt).toLocaleString('zh-CN', { hour12: false })}</td><td>{usageTaskNames[log.task]}</td><td>{log.connectionLabel} · {log.model}</td><td><span className={`chip ${log.status === 'SUCCESS' ? 'mint' : 'red'}`}>{log.status === 'SUCCESS' ? '成功' : '失败'}</span>{log.error && <small className="usage-error">{log.error}</small>}</td><td>{log.inputTokens ?? '-'} / {log.outputTokens ?? '-'}</td><td>{(log.durationMs / 1000).toFixed(1)}s</td></tr>)}</tbody></table>}</section>;
}




function connectionDraftForProvider(provider: ModelProvider): ModelDraft {
  return { ...draftForProvider(provider), model: '', purposes: [] };
}

function ExternalApiConnections({ connections, onNew, onEdit, onRemove }: { connections: ModelConnection[]; onNew: () => void; onEdit: (connection: ModelConnection) => void; onRemove: (connection: ModelConnection) => Promise<void> }) {
  return <section className="external-api-page"><div className="external-api-head"><h2>外部 API 连接</h2><button className="button primary" onClick={onNew}><Plus size={16}/>新增连接</button></div>{connections.length === 0 ? <div className="external-api-empty"><KeyRound size={24}/><h2>尚未添加连接</h2><button className="button" onClick={onNew}>新增连接</button></div> : <div className="external-connection-list">{connections.map((connection) => <article className="external-connection-row" key={connection.id}><div className="connection-provider"><span className={`connection-status ${connection.status.toLowerCase()}`} /><div><b>{connection.label}</b><small>{providerLabels[connection.provider]} · {connection.baseUrl}</small></div></div><span className={`chip ${connection.status === 'READY' ? 'mint' : connection.status === 'ERROR' ? 'red' : 'yellow'}`}>{connection.status === 'READY' ? '已验证' : connection.status === 'ERROR' ? '异常' : '待验证'}</span><div className="connection-actions"><button className="text-button" onClick={() => onEdit(connection)}><Pencil size={15}/>编辑</button><button className="icon-button danger-icon" aria-label={`移除 ${connection.label}`} onClick={() => void onRemove(connection)}><Trash2 size={17}/></button></div></article>)}</div>}</section>;
}

function ExternalApiEditor({ connection, onBack, onSave, onTest }: { connection?: ModelConnection; onBack: () => void; onSave: (input: ModelConnectionInput) => Promise<ModelConnection>; onTest: (input: ModelConnectionInput) => Promise<ModelConnection> }) {
  const [draft, setDraft] = useState<ModelDraft>(() => connection ? { ...connectionDraftForProvider(connection.provider), ...connection, apiKey: '' } : connectionDraftForProvider('SILICONFLOW'));
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const makeInput = (): ModelConnectionInput => ({ ...draft, model: '', purposes: [], apiKey: draft.apiKey.trim() || undefined });
  const save = async () => {
    if (!draft.apiKey.trim() && !draft.id) { setNotice({ type: 'error', text: '请输入 API Key。' }); return; }
    setBusy('saving'); setNotice(null);
    try { const saved = await onSave(makeInput()); setDraft({ ...connectionDraftForProvider(saved.provider), ...saved, apiKey: '' }); setNotice({ type: 'success', text: '已保存' }); }
    catch (error) { setNotice({ type: 'error', text: displayError(error, '保存失败。') }); }
    finally { setBusy('idle'); }
  };
  const test = async () => {
    if (!draft.apiKey.trim() && !draft.id) { setNotice({ type: 'error', text: '请输入 API Key。' }); return; }
    setBusy('testing'); setNotice(null);
    try { const result = await onTest(makeInput()); setDraft({ ...connectionDraftForProvider(result.provider), ...result, apiKey: '' }); setNotice(result.status === 'READY' ? { type: 'success', text: '已验证，模型将在任务策略中同步。' } : { type: 'error', text: result.lastError || '连接失败。' }); }
    catch (error) { setNotice({ type: 'error', text: displayError(error, '连接失败。') }); }
    finally { setBusy('idle'); }
  };
  return <div className="external-editor"><button className="back-button" onClick={onBack}><ArrowLeft size={17}/>返回</button><PageHeader eyebrow="SETTINGS / 外部 API" title={connection ? `编辑 ${connection.label}` : '新增外部 API'} /><section className="external-provider-picker"><div className="provider-grid">{externalModelProviders.map((item) => <button type="button" key={item.provider} className={`provider-card ${draft.provider === item.provider ? 'selected' : ''}`} onClick={() => { setDraft(connectionDraftForProvider(item.provider)); setNotice(null); }}><b>{item.label}</b><small>{item.detail}</small></button>)}</div></section><section className="external-editor-form"><label>连接名称<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><label>API 地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label><label>API Key<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.id ? '留空表示不更新' : '粘贴 API Key'} autoComplete="off" /></label>{notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}<footer><button className="button" type="button" disabled={busy !== 'idle'} onClick={() => void test()}><KeyRound size={16}/>{busy === 'testing' ? '检查中' : '保存并检查'}</button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void save()}>{busy === 'saving' ? '保存中' : '保存'}</button></footer></section></div>;
}


function WorkspaceSettings({ template, onTemplateChange }: { template: FeishuLibraryTemplate; onTemplateChange: (template: FeishuLibraryTemplate) => void }) {
  return <><PageHeader title="飞书 Base" /><FeishuTemplateEditor template={template} onChange={onTemplateChange} /></>;
}

function FeishuTemplateEditor({ template, onChange }: { template: FeishuLibraryTemplate; onChange: (template: FeishuLibraryTemplate) => void }) {
  const tables = ['热点库', '选题池', ...(template.includeSchedule ? ['内容排期'] : []), ...(template.includeReview ? ['复盘数据'] : []), '同步日志'];
  const update = (patch: Partial<FeishuLibraryTemplate>) => onChange({ ...template, ...patch, status: 'READY_TO_CREATE' });
  return <section className="feishu-template"><div className="template-head"><div><div className="eyebrow">FEISHU / 内容库模板</div><h2>先定义内容库，再授权创建</h2><p>不会写入你的现有 Base；真正创建前会要求飞书授权和最终确认。</p></div><span className="chip yellow">{template.status === 'DRAFT' ? '待配置' : template.status === 'CREATED' ? '已创建' : '待授权创建'}</span></div><div className="template-grid"><label>内容库名称<input value={template.name} onChange={(event) => update({ name: event.target.value })} /></label><fieldset><legend>题材组织方式</legend><button className={template.topicStorage === 'ONE_TABLE' ? 'chosen' : ''} onClick={() => update({ topicStorage: 'ONE_TABLE' })} type="button">一张总表</button><button className={template.topicStorage === 'BY_CATEGORY' ? 'chosen' : ''} onClick={() => update({ topicStorage: 'BY_CATEGORY' })} type="button">按题材分表</button></fieldset><label className="toggle-line"><input type="checkbox" checked={template.includeSchedule} onChange={(event) => update({ includeSchedule: event.target.checked })} />创建内容排期表</label><label className="toggle-line"><input type="checkbox" checked={template.includeReview} onChange={(event) => update({ includeReview: event.target.checked })} />创建复盘数据表</label></div><div className="template-preview"><b>生成预览</b><div>{tables.map((table) => <span key={table}>{table}</span>)}</div><small>热点库和选题池会包含受保护的 <code>content_engine_id</code> 字段，用于稳定同步。</small></div><button className="button primary" type="button" disabled>下一步：授权并创建（云端 OAuth 开发中）</button></section>;
}

function WebSearchSettings({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }) {
  const [apiKey, setApiKey] = useState(''); const [status, setStatus] = useState<CredentialStatus | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const load = () => void webIntelligence.webSearchStatus().then(setStatus).catch((error) => setNotice({ type: 'error', text: displayError(error, '读取配置失败。') }));
  useEffect(load, []);
  const saveAndTest = async () => { if (!apiKey.trim()) return; setBusy(true); setNotice(null); try { await saveWebSearchKey(apiKey.trim()); const result = await webSettings.testCredential('TAVILY'); setApiKey(''); setStatus(result); onChanged?.(); setNotice(result.status === 'READY' ? { type: 'success', text: '已保存并验证' } : { type: 'error', text: result.lastError || '检测未通过' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '保存或检测失败。') }); } finally { setBusy(false); } };
  const retest = async () => { setBusy(true); setNotice(null); try { const result = await webSettings.testCredential('TAVILY'); setStatus(result); onChanged?.(); setNotice(result.status === 'READY' ? { type: 'success', text: '检测通过' } : { type: 'error', text: result.lastError || '检测未通过' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '检测失败。') }); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('确定移除 Tavily API Key 吗？网页检索将不可用。')) return; setBusy(true); try { await webSettings.removeCredential('TAVILY'); setStatus({ provider: 'TAVILY', configured: false, status: 'UNCONFIGURED' }); setApiKey(''); onChanged?.(); setNotice({ type: 'success', text: '已移除' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '移除失败。') }); } finally { setBusy(false); } };
  const configured = Boolean(status?.configured); const state = status?.status ?? 'UNCONFIGURED';
  const panel = <section className="web-search-settings"><div className="web-search-settings-head"><div><h2>Tavily</h2><small>{state === 'READY' ? '已验证' : state === 'ERROR' ? status?.lastError : configured ? '待验证' : '尚未配置'}</small></div><div className="credential-actions"><span className={`chip ${state === 'READY' ? 'mint' : state === 'ERROR' ? 'red' : 'yellow'}`}>{state === 'READY' ? '可用' : state === 'ERROR' ? '异常' : configured ? '待验证' : '待配置'}</span>{configured && <button className="text-button danger" disabled={busy} onClick={() => void remove()}>移除</button>}</div></div><div className="web-search-key-form"><label>Tavily API Key<input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setNotice(null); }} placeholder={configured ? '输入新 Key 以替换' : '粘贴 Tavily API Key'} autoComplete="off" /></label>{apiKey.trim() ? <button className="button primary" disabled={busy} onClick={() => void saveAndTest()}>{busy ? '检测中' : '保存并检测'}</button> : <button className="button" disabled={busy || !configured} onClick={() => void retest()}>{busy ? '检测中' : '重新检测'}</button>}</div>{status?.lastTestedAt && <small className="credential-time">最近检测：{new Date(status.lastTestedAt).toLocaleString('zh-CN', { hour12: false })}</small>}{notice && <p className={notice.type === 'success' ? 'web-search-success' : 'form-error'} aria-live="polite">{notice.text}</p>}</section>;
  return embedded ? panel : <><PageHeader eyebrow="SETTINGS / 模型与 API" title="检索 API" />{panel}</>;
}

function BailianCredentialSettings({ onChanged }: { onChanged: () => void }) {
  const [apiKey, setApiKey] = useState(''); const [status, setStatus] = useState<CredentialStatus | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const load = () => void webAgent.credentialStatus().then(setStatus).catch((error) => setNotice({ type: 'error', text: displayError(error, '无法读取百炼配置。') }));
  useEffect(load, []);
  const saveAndTest = async () => { if (!apiKey.trim()) return; setBusy(true); setNotice(null); try { await webAgent.saveCredential(apiKey.trim()); const result = await webAgent.testCredential(); setApiKey(''); setStatus(result); if (result.status === 'READY') { onChanged(); setNotice({ type: 'success', text: '已保存并验证，可同步模型' }); } else setNotice({ type: 'error', text: result.lastError || '检测未通过' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '保存或检测失败。') }); } finally { setBusy(false); } };
  const retest = async () => { setBusy(true); setNotice(null); try { const result = await webAgent.testCredential(); setStatus(result); if (result.status === 'READY') { onChanged(); setNotice({ type: 'success', text: '检测通过' }); } else setNotice({ type: 'error', text: result.lastError || '检测未通过' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '检测失败。') }); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm('确定移除百炼 API Key 吗？核心 Agent 和依赖该连接的任务策略会被清除。')) return; setBusy(true); try { await webAgent.removeCredential(); setStatus({ provider: 'BAILIAN', configured: false, status: 'UNCONFIGURED' }); setApiKey(''); onChanged(); setNotice({ type: 'success', text: '已移除' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '移除失败。') }); } finally { setBusy(false); } };
  const configured = Boolean(status?.configured); const state = status?.status ?? 'UNCONFIGURED';
  return <section className="bailian-web-settings"><div className="core-agent-head"><div><h2>百炼</h2><small>{state === 'READY' ? '已验证，可同步模型并分配任务' : state === 'ERROR' ? status?.lastError : configured ? '已保存，等待检测' : '尚未配置'}</small></div><div className="credential-actions"><span className={`chip ${state === 'READY' ? 'mint' : state === 'ERROR' ? 'red' : 'yellow'}`}>{state === 'READY' ? '可用' : state === 'ERROR' ? '异常' : configured ? '待验证' : '待配置'}</span>{configured && <button className="text-button danger" disabled={busy} onClick={() => void remove()}>移除</button>}</div></div><div className="bailian-web-grid"><label>百炼 API Key<input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setNotice(null); }} placeholder={configured ? '输入新 Key 以替换' : '粘贴百炼 API Key'} autoComplete="off" /></label>{apiKey.trim() ? <button className="button primary" disabled={busy} onClick={() => void saveAndTest()}>{busy ? '检测中' : '保存并检测'}</button> : <button className="button" disabled={busy || !configured} onClick={() => void retest()}>{busy ? '检测中' : '重新检测'}</button>}</div>{status?.lastTestedAt && <small className="credential-time">最近检测：{new Date(status.lastTestedAt).toLocaleString('zh-CN', { hour12: false })}</small>}{notice && <p className={notice.type === 'success' ? 'web-search-success' : 'form-error'} aria-live="polite">{notice.text}</p>}</section>;
}

function CoreAgentSettings({ catalog, onSynced }: { catalog: ModelCatalogItem[]; onSynced: () => void }) {
  const [credential, setCredential] = useState<CredentialStatus | null>(null); const [model, setModel] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { const load = async () => { try { const [status, policy] = await Promise.all([webAgent.credentialStatus(), webAgent.policy()]); setCredential(status); setModel(policy.model ?? ''); } catch (error) { setNotice({ type: 'error', text: displayError(error, '无法读取核心 Agent 配置。') }); } }; void load(); }, []);
  const models = catalog.filter((item) => item.provider === 'BAILIAN_CLI' && item.capabilities.includes('TEXT'));
  const sync = async () => { setBusy(true); setNotice(null); try { const result = await webModels.syncCatalog(); onSynced(); setNotice(result.errors[0] ? { type: 'error', text: result.errors[0].message } : { type: 'success', text: `已同步 ${result.items.length} 个模型` }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '同步失败。') }); } finally { setBusy(false); } };
  const saveModel = async () => { if (!model.trim()) return; setBusy(true); setNotice(null); try { await webAgent.savePolicy(model); setNotice({ type: 'success', text: '已保存' }); } catch (error) { setNotice({ type: 'error', text: displayError(error, '保存失败。') }); } finally { setBusy(false); } };
  const ready = credential?.status === 'READY';
  return <section className="core-agent-settings"><div className="core-agent-head"><div><h2>核心 Agent</h2><small>{ready ? '复用百炼连接' : '请先完成百炼检测'}</small></div><span className={`chip ${ready ? 'mint' : 'yellow'}`}>{ready ? '可配置' : '待验证百炼'}</span></div><div className="core-agent-grid model-only"><label>规划模型<select value={model} onChange={(event) => { setModel(event.target.value); setNotice(null); }} disabled={!ready}><option value="">选择已同步模型</option>{models.map((item) => <option key={item.id} value={item.model}>{item.model}</option>)}</select></label><button className="button" disabled={busy || !ready} onClick={() => void sync()}>{busy ? '同步中' : '同步模型'}</button><button className="button primary" disabled={busy || !ready || !model.trim()} onClick={() => void saveModel()}>{busy ? '保存中' : '保存模型'}</button></div>{notice && <p className={notice.type === 'success' ? 'web-search-success' : 'form-error'} aria-live="polite">{notice.text}</p>}</section>;
}


function Utility({ title, description }: { title: string; description: string }) { return <><PageHeader eyebrow="UTILITY / 辅助能力" title={title}/><section className="utility"><Lightbulb size={24}/><h2>该模块已预留</h2><p>{description}</p></section></>; }

function WebEntry() {
  const [session, setSession] = useState<WebSession | null>(() => webAuth.session());
  const [checking, setChecking] = useState(Boolean(webAuth.session()));
  useEffect(() => {
    if (!webAuth.session()) return;
    void webAuth.me().catch(() => { webAuth.clear(); setSession(null); }).finally(() => setChecking(false));
  }, []);
  if (checking) return <section className="web-entry-loading">正在连接工作空间</section>;
  return session ? <App /> : <WebAuthScreen onAuthenticated={setSession} />;
}

function WebAuthScreen({ onAuthenticated }: { onAuthenticated: (session: WebSession) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [displayName, setDisplayName] = useState(''); const [workspaceName, setWorkspaceName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const session = mode === 'login' ? await webAuth.login({ email, password }) : await webAuth.register({ email, password, displayName: displayName || email.split('@')[0] || '创作者', workspaceName: workspaceName || '我的内容工作室' }); onAuthenticated(session); } catch (reason) { setError(displayError(reason, '登录失败。')); } finally { setBusy(false); } };
  return <main className="web-auth"><section className="web-auth-panel"><div className="eyebrow">CONTENT ENGINE / WEB</div><h1>{mode === 'login' ? '进入内容工作室' : '创建内容工作室'}</h1><form onSubmit={submit}>{mode === 'register' && <><label>你的名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus /></label><label>工作室名称<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label></>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus={mode === 'login'} /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>{error && <p className="form-error">{error}</p>}<button className="button primary wide" disabled={busy} type="submit">{busy ? '处理中' : mode === 'login' ? '登录' : '创建并进入'}</button></form><button className="text-button" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '创建新工作室' : '已有账号，去登录'}</button></section></main>;
}

const rootElement = document.getElementById('root')!;
createRoot(rootElement).render(<WebEntry />);
