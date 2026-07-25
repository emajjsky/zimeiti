import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, createScope, stagger } from 'animejs';
import { ArrowLeft, AudioLines, Bell, BrainCircuit, CalendarDays, ChartColumn, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, ClipboardList, Compass, FolderOpen, Image, KeyRound, Lightbulb, PenLine, Pencil, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Trash2, Video, Zap } from 'lucide-react';
import { intelligenceKey, loadState, persistState, seedState, type FeishuLibraryTemplate, type LocalState, type WorkspaceProfile } from './data/localRepository';
import { webAgent, webAuth, webIntelligence, webModels, webSettings, type CredentialStatus, type WebSession } from './data/webApi';
import { platformName, projectStatusName, type ContentProject, type ContentVersion, type IntelligenceSource, type Platform, type TopicCandidate } from './domain/content';
import type { ApiUsageLog, ApiUsageSummary, BailianCapabilityScope, BailianCliStatus, ModelCapability, ModelCatalogItem, ModelConnection, ModelConnectionInput, ModelOperation, ModelProvider, ModelTask, ModelTaskPolicy } from './domain/integrations';
import './styles.css';

type View = 'today' | 'discover' | 'sources' | 'clip' | 'plan' | 'topicEditor' | 'create' | 'publish' | 'review' | 'assets' | 'automation' | 'models' | 'settings';

function displayError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

function previewPublicLink(url: string) { return window.contentEngine ? window.contentEngine.intelligence.previewLink(url) : webIntelligence.previewLink(url); }
async function refreshRssSources(sources: LocalState['sources']): Promise<{ items: LocalState['intelligence']; results: { sourceId: string; ok: boolean; count: number; error?: string }[]; sources?: LocalState['sources'] }> {
  return window.contentEngine ? window.contentEngine.intelligence.refreshRss(sources) : webIntelligence.refreshRss();
}
function webSearchStatus() { return window.contentEngine ? window.contentEngine.intelligence.webSearchStatus() : webIntelligence.webSearchStatus(); }
function saveWebSearchKey(apiKey: string) { return window.contentEngine ? window.contentEngine.intelligence.saveWebSearchKey(apiKey) : webIntelligence.saveWebSearchKey(apiKey); }
function searchWeb(input: { query: string; category: string; domains: string[] }) { return window.contentEngine ? window.contentEngine.intelligence.searchWeb(input) : webIntelligence.searchWeb(input); }

const mainNav: { view: View; label: string; icon: typeof CalendarDays }[] = [
  { view: 'today', label: '今天', icon: CalendarDays },
  { view: 'discover', label: '发现', icon: Compass },
  { view: 'plan', label: '规划', icon: ClipboardList },
  { view: 'create', label: '创作', icon: PenLine },
  { view: 'publish', label: '发布', icon: Send },
  { view: 'review', label: '复盘', icon: ChartColumn },
];

const utilityNav: { view: View; label: string; icon: typeof CalendarDays }[] = [
  { view: 'assets', label: '素材库', icon: FolderOpen },
  { view: 'sources', label: '情报源', icon: Compass },
  { view: 'clip', label: '剪藏链接', icon: Compass },
  { view: 'automation', label: '网页搜索', icon: Zap },
  { view: 'models', label: '模型与 API', icon: Settings },
  { view: 'settings', label: '设置', icon: Settings },
];

function App() {
  const [view, setView] = useState<View>('today');
  const [state, setState] = useState<LocalState>(seedState);
  const [selectedIntelId, setSelectedIntelId] = useState('intel-sora');
  const [selectedTopicId, setSelectedTopicId] = useState('topic-ai-video');
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('project-ai-video');
  const [activePlatform, setActivePlatform] = useState<Platform>('WECHAT');
  const [isLoaded, setIsLoaded] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string }>({ status: 'idle', message: '' });
  const [analysisFeedback, setAnalysisFeedback] = useState<{ status: 'idle' | 'running' | 'error'; message: string }>({ status: 'idle', message: '' });

  const selectedIntel = state.intelligence.find((item) => item.id === selectedIntelId) ?? state.intelligence[0];
  const selectedTopic = state.topics.find((item) => item.id === selectedTopicId) ?? state.topics[0];
  const featuredProject = state.projects.find((item) => item.id === selectedProjectId) ?? state.projects[0];

  useEffect(() => {
    void loadState().then((loaded) => {
      setState(loaded);
      setSelectedIntelId(loaded.intelligence[0]?.id ?? '');
    }).catch((error) => {
      console.error('加载本地工作空间失败', error);
    }).finally(() => setIsLoaded(true));
  }, []);

  useEffect(() => window.contentEngine?.intelligence.onUpdated((intelligence) => {
    setState((current) => ({ ...current, intelligence }));
  }), []);

  const updateState = (next: LocalState) => {
    setState(next);
    void persistState(next).catch((error) => {
      console.error('保存本地工作空间失败', error);
    });
  };
  const completeSetup = (workspace: WorkspaceProfile) => {
    updateState({ ...state, workspace: { ...workspace, setupCompleted: true } });
  };
  const createTopicFromIntel = () => {
    if (!selectedIntel) return;
    const id = `topic-${Date.now()}`;
    const next = { ...state, topics: [{ id, title: selectedIntel.title, category: selectedIntel.category, platforms: ['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'] as Platform[], urgency: '中' as const, status: 'PENDING' as const, coreViewpoint: selectedIntel.summary, sourceIds: [selectedIntel.id] }, ...state.topics] };
    updateState(next); setSelectedTopicId(id); setView('plan');
  };
  const openTopicEditor = (topic?: TopicCandidate) => {
    if (topic?.status === 'PROJECT_CREATED') {
      window.alert('该选题已经立项，请在内容项目中继续编辑。');
      return;
    }
    setEditingTopicId(topic?.id ?? null);
    setView('topicEditor');
  };
  const saveTopic = (draft: Omit<TopicCandidate, 'id' | 'status' | 'sourceIds'>) => {
    if (editingTopicId) {
      const next = { ...state, topics: state.topics.map((topic) => topic.id === editingTopicId ? { ...topic, ...draft } : topic) };
      updateState(next);
      setSelectedTopicId(editingTopicId);
    } else {
      const id = `topic-${Date.now()}`;
      const next = { ...state, topics: [{ ...draft, id, status: 'PENDING' as const, sourceIds: [] }, ...state.topics] };
      updateState(next);
      setSelectedTopicId(id);
    }
    setEditingTopicId(null);
    setView('plan');
  };
  const deleteTopic = (topic: TopicCandidate) => {
    if (topic.status === 'PROJECT_CREATED') {
      window.alert('该选题已经立项，请在项目归档后再处理。');
      return;
    }
    if (!window.confirm(`确定删除「${topic.title}」吗？`)) return;
    const remaining = state.topics.filter((item) => item.id !== topic.id);
    updateState({ ...state, topics: remaining });
    setSelectedTopicId(remaining[0]?.id ?? '');
  };
  const createProjectFromTopic = () => {
    if (!selectedTopic) return;
    const existing = state.projects.find((project) => project.title === selectedTopic.title);
    if (existing) {
      setSelectedProjectId(existing.id);
      setActivePlatform(existing.versions[0]?.platform ?? 'WECHAT');
      setView('create');
      return;
    }
    const id = `project-${Date.now()}`;
    const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const project: ContentProject = {
      id,
      title: selectedTopic.title,
      status: 'BRIEF',
      coreViewpoint: selectedTopic.coreViewpoint,
      factChecks: [],
      updatedAt: now,
      versions: selectedTopic.platforms.map((platform) => ({
        id: `${id}-${platform.toLowerCase()}`,
        platform,
        status: 'DRAFT',
        title: selectedTopic.title,
        body: selectedTopic.coreViewpoint,
        updatedAt: now,
      })),
    };
    const next: LocalState = {
      ...state,
      topics: state.topics.map((topic) => topic.id === selectedTopic.id ? { ...topic, status: 'PROJECT_CREATED' } : topic),
      projects: [project, ...state.projects],
    };
    updateState(next);
    setSelectedProjectId(id);
    setActivePlatform(project.versions[0]?.platform ?? 'WECHAT');
    setView('create');
  };
  const saveContentVersion = (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => {
    const updatedAt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const next: LocalState = {
      ...state,
      projects: state.projects.map((project) => project.id !== projectId ? project : {
        ...project,
        status: project.status === 'BRIEF' ? 'WRITING' : project.status,
        updatedAt,
        versions: project.versions.map((version) => version.id === versionId ? { ...version, ...patch, updatedAt } : version),
      }),
    };
    updateState(next);
  };
  const refreshRss = async () => {
    if (state.sources.filter((source) => source.enabled).length === 0) {
      window.alert('请先在“情报源”中添加并启用 RSS 情报源。');
      setView('sources');
      return;
    }
    setRefreshFeedback({ status: 'running', message: '正在读取已启用的情报源…' });
    try {
      const result = await refreshRssSources(state.sources);
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
  const addSource = (source: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>) => {
    if (!window.contentEngine && webAuth.session()) { void webIntelligence.createSources([source]).then((saved) => updateState({ ...state, sources: [...state.sources, ...saved] })).catch((error) => window.alert(displayError(error, '添加资讯来源失败。'))); return; }
    updateState({ ...state, sources: [...state.sources, { ...source, id: `source-${Date.now()}` }] });
  };
  const addSources = (sources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[]) => {
    if (!window.contentEngine && webAuth.session()) { void webIntelligence.createSources(sources).then((saved) => { const existingIds = new Set(state.sources.map((source) => source.id)); updateState({ ...state, sources: [...state.sources, ...saved.filter((source) => !existingIds.has(source.id))] }); }).catch((error) => window.alert(displayError(error, '添加资讯来源失败。'))); return; }
    const existingUrls = new Set(state.sources.map((source) => source.url.trim().toLowerCase()));
    const additions = sources.filter((source) => !existingUrls.has(source.url.trim().toLowerCase())).map((source, index) => ({ ...source, id: `source-${Date.now()}-${index}` }));
    if (additions.length) updateState({ ...state, sources: [...state.sources, ...additions] });
  };
  const analyzeIntelligence = async () => {
    if (!selectedIntel) return;
    if (!window.contentEngine) { setAnalysisFeedback({ status: 'error', message: '请在桌面端执行 AI 分析。' }); return; }
    setAnalysisFeedback({ status: 'running', message: '正在分析…' });
    try {
      const analysis = await window.contentEngine.intelligence.analyze(selectedIntel);
      const next = { ...state, intelligence: state.intelligence.map((item) => item.id === selectedIntel.id ? { ...item, summary: analysis.summary, heat: analysis.heat, analysis } : item) };
      updateState(next);
      setAnalysisFeedback({ status: 'idle', message: '' });
    } catch (error) {
      setAnalysisFeedback({ status: 'error', message: displayError(error, 'AI 分析失败。') });
    }
  };
  const removeSource = (sourceId: string) => {
    if (!window.contentEngine && webAuth.session()) { void webIntelligence.removeSource(sourceId).then(() => updateState({ ...state, sources: state.sources.filter((source) => source.id !== sourceId) })).catch((error) => window.alert(displayError(error, '移除资讯来源失败。'))); return; }
    updateState({ ...state, sources: state.sources.filter((source) => source.id !== sourceId) });
  };
  const saveFeishuTemplate = (feishuTemplate: FeishuLibraryTemplate) => updateState({ ...state, feishuTemplate });
  const saveClippedLink = (item: Omit<LocalState['intelligence'][number], 'id'>) => {
    const id = `clip-${Date.now()}`;
    updateState({ ...state, intelligence: [{ ...item, id }, ...state.intelligence] });
    setSelectedIntelId(id); setView('discover');
  };
  const saveSearchCandidate = (item: LocalState['intelligence'][number]) => {
    if (state.intelligence.some((current) => intelligenceKey(current) === intelligenceKey(item))) return;
    updateState({ ...state, intelligence: [{ ...item, id: `search-${Date.now()}` }, ...state.intelligence] });
  };
  const projectVersions = featuredProject?.versions ?? [];
  const activeVersion = projectVersions.find((item) => item.platform === activePlatform);
  const platformProgress = useMemo(() => projectVersions.filter((version) => version.status === 'PREFLIGHT_PASSED').length, [projectVersions]);

  if (!isLoaded) return <div className="boot-screen"><div className="boot-mark">内容引擎</div><p>正在准备你的编辑部……</p></div>;
  if (!state.workspace.setupCompleted) return <Onboarding initial={state.workspace} onComplete={completeSetup} />;

  return <div className="app-shell">
    <header className="topbar">
      <div className="wordmark">知行<span>内容</span>实验室</div>
      <label className="global-search"><Search size={17}/><input placeholder="搜索热点、选题、内容、素材" /></label>
      <div className="top-actions"><button className="button primary" onClick={() => openTopicEditor()}><Plus size={16}/>新建选题</button><button className="icon-button" aria-label="通知"><Bell size={20}/></button><button className="icon-button" aria-label="同步"><RefreshCw size={20}/></button><span className="avatar" /></div>
    </header>
    <aside className="sidebar">
      <div className="workspace"><div className="workspace-title"><span className="stamp">内</span><b>内容引擎</b></div><small>DESKTOP · V0.1</small><button className="button new-topic" onClick={() => openTopicEditor()}><Plus size={16}/>新建选题</button></div>
      <nav>{mainNav.map(({ view: target, label, icon: Icon }) => <button key={target} className={`nav-item ${view === target ? 'active' : ''}`} onClick={() => setView(target)}><Icon size={20}/>{label}</button>)}<div className="nav-divider"/>{utilityNav.map(({ view: target, label, icon: Icon }) => <button key={target} className={`nav-item ${view === target ? 'active' : ''}`} onClick={() => setView(target)}><Icon size={20}/>{label}</button>)}</nav>
      <div className="sidebar-footer">◌ 帮助中心</div>
    </aside>
    <main className="main-content">
      {view === 'today' && <Today onNavigate={setView} projects={state.projects} intelligence={state.intelligence} />}
      {view === 'discover' && <Discover item={selectedIntel} intelligence={state.intelligence} sources={state.sources} topics={state.topics} projects={state.projects} onSelect={setSelectedIntelId} onCreateTopic={createTopicFromIntel} onRefresh={refreshRss} refreshFeedback={refreshFeedback} analysisFeedback={analysisFeedback} onAnalyze={analyzeIntelligence} />}
      {view === 'sources' && <SettingsHub sources={state.sources} onAddSource={addSource} onAddSources={addSources} onRemoveSource={removeSource} />}
      {view === 'clip' && <LinkClipEditor onSave={saveClippedLink} onCancel={() => setView('discover')} />}
      {view === 'plan' && selectedTopic && <Plan topics={state.topics} selected={selectedTopic} onSelect={setSelectedTopicId} onCreateProject={createProjectFromTopic} onEdit={openTopicEditor} onDelete={deleteTopic} />}
      {view === 'topicEditor' && <TopicEditor key={editingTopicId ?? 'new'} topic={state.topics.find((topic) => topic.id === editingTopicId)} defaultCategory={state.workspace.primaryTopics[0] ?? '未分类'} onSave={saveTopic} onCancel={() => { setEditingTopicId(null); setView('plan'); }} />}
      {view === 'create' && <Create project={featuredProject} activePlatform={activePlatform} onPlatform={setActivePlatform} activeVersion={activeVersion} progress={platformProgress} onSaveVersion={saveContentVersion} />}
      {view === 'publish' && <Publish project={featuredProject} onNavigate={setView} />}
      {view === 'review' && <Review onNavigate={setView} />}
      {view === 'assets' && <Utility title="素材库" description="本地与云端素材将以目录、紧凑列表和素材检查器呈现；不会打断内容项目主编辑流程。" />}
      {view === 'automation' && <WebSearchPanel onSave={saveSearchCandidate} onNavigate={setView} />}
      {view === 'models' && <ModelSettingsScreen />}
      {view === 'settings' && <WorkspaceSettings template={state.feishuTemplate} onTemplateChange={saveFeishuTemplate} />}
    </main>
  </div>;
}

function Onboarding({ initial, onComplete }: { initial: WorkspaceProfile; onComplete: (workspace: WorkspaceProfile) => void }) {
  const [name, setName] = useState(initial.name);
  const [topics, setTopics] = useState(initial.primaryTopics.join('、'));
  const [materialRoot, setMaterialRoot] = useState(initial.materialRoot);
  const [platforms, setPlatforms] = useState<Platform[]>(initial.enabledPlatforms);
  const togglePlatform = (platform: Platform) => setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || platforms.length === 0) return;
    onComplete({
      name: name.trim(),
      materialRoot: materialRoot.trim(),
      primaryTopics: topics.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
      enabledPlatforms: platforms,
      setupCompleted: true,
    });
  };
  return <main className="onboarding-shell">
    <section className="onboarding-poster"><div className="poster-stamp">NO.01</div><div><span>CONTENT ENGINE</span><h1>把灵感，<br/>变成稳定产出。</h1></div><p>先设置你的内容工作室。后续热点、素材与草稿都将以这里为本地起点。</p><div className="poster-dots">● ● ●</div></section>
    <form className="onboarding-form" onSubmit={submit}>
      <div className="eyebrow">FIRST RUN / 首次设置</div><h2>建立你的编辑部</h2><p>只需一分钟；飞书、模型和账号授权都可以稍后连接。</p>
      <label>工作空间名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：知行内容实验室" autoFocus /></label>
      <label>你最常做的题材<input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="例如：AI 工具、国学、财经" /><small>用顿号或逗号分隔，之后可随时调整。</small></label>
      <fieldset><legend>首发平台</legend><div className="platform-options">{(['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'] as Platform[]).map((platform) => <button type="button" key={platform} className={platforms.includes(platform) ? 'chosen' : ''} onClick={() => togglePlatform(platform)}>{platforms.includes(platform) ? '✓ ' : '+ '}{platformName[platform]}</button>)}</div></fieldset>
      <label>本地素材目录 <span>（可稍后填写）</span><input value={materialRoot} onChange={(event) => setMaterialRoot(event.target.value)} placeholder="例如：D:\内容素材" /></label>
      <button className="button primary setup-submit" type="submit" disabled={!name.trim() || platforms.length === 0}>进入内容引擎 <ChevronRight size={17}/></button>
    </form>
  </main>;
}

function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) { return <><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}<div className="editorial-rule" /></>; }

function Today({ onNavigate, projects, intelligence }: { onNavigate: (view: View) => void; projects: ContentProject[]; intelligence: LocalState['intelligence'] }) { return <>
  <PageHeader eyebrow="TODAY / 行动中心" title="今天，7 月 22 日" subtitle="你有 3 件内容工作需要确认。" />
  <div className="today-layout"><div>
    <section className="panel"><div className="panel-head"><h2>▣ 今日优先事项</h2><span className="chip mint">2 待办</span></div><div className="task-list"><Task title="确认选题：普通人如何用 AI 做知识视频" sub="高优先级 · 小红书 · 今日 11:00 前" action="去确认" onClick={() => onNavigate('plan')} /><Task title="审核小红书 8 页图文" sub="视觉版本已提交 V2，需今日定稿" action="审核" onClick={() => onNavigate('create')} /></div></section>
    <div className="editorial-rule compact" /><section className="panel"><div className="panel-head"><h2>✎ 进行中的内容项目</h2><button className="text-button" onClick={() => onNavigate('create')}>查看全部</button></div><div className="project-grid">{projects.slice(0,2).map((project) => <article className="project-card" key={project.id}><span className="chip yellow">{projectStatusName[project.status]}</span><h3>{project.title}</h3><p>{project.coreViewpoint}</p><footer><span>更新于 {project.updatedAt}</span><button className="text-button" onClick={() => onNavigate('create')}>继续编辑</button></footer></article>)}</div></section>
  </div><aside className="today-aside"><section className="hot-card"><h2>♨ 今日热点</h2>{intelligence.map((item) => <div key={item.id}><small>#{item.category}</small><strong>{item.title}</strong></div>)}<button className="text-button inverted" onClick={() => onNavigate('discover')}>前往发现中心 →</button></section><section className="schedule-card"><h2>▣ 近期排期</h2><p><b>今天 · 7.22</b><br/>发布：Notion 教程下集<br/>平台：视频号、小红书</p><p><b>明天 · 7.23</b><br/>截稿：周报大纲审核</p></section></aside></div>
  </>; }

function Task({ title, sub, action, onClick }: { title: string; sub: string; action: string; onClick: () => void }) { return <article className="task"><span className="checkbox"/><div><b>{title}</b><small>{sub}</small></div><button className="text-button" onClick={onClick}>{action}</button></article>; }

function Discover({ item, intelligence, sources: configuredSources, topics, projects, onSelect, onCreateTopic, onRefresh, refreshFeedback, analysisFeedback, onAnalyze }: { item?: LocalState['intelligence'][number]; intelligence: LocalState['intelligence']; sources: LocalState['sources']; topics: LocalState['topics']; projects: LocalState['projects']; onSelect: (id: string) => void; onCreateTopic: () => void; onRefresh: () => void; refreshFeedback: { status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string }; analysisFeedback: { status: 'idle' | 'running' | 'error'; message: string }; onAnalyze: () => void }) {
  const [category, setCategory] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [language, setLanguage] = useState('ALL');
  const [timeRange, setTimeRange] = useState<'DAY' | 'WEEK' | 'MONTH'>('MONTH');
  const [query, setQuery] = useState('');
  const categories = [...new Set(intelligence.map((signal) => signal.category).filter(Boolean))];
  const sourceNames = [...new Set(intelligence.map((signal) => signal.source).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const detect = (value: string) => /[\u3400-\u9fff]/.test(value) ? 'zh' : /[a-z]/i.test(value) ? 'en' : 'other';
  const rangeStart = { DAY: 24 * 60 * 60 * 1000, WEEK: 7 * 24 * 60 * 60 * 1000, MONTH: 30 * 24 * 60 * 60 * 1000 }[timeRange];
  const isWithinRange = (publishedAt: string) => {
    if (publishedAt === '刚刚') return true;
    const timestamp = new Date(publishedAt).valueOf();
    return !Number.isFinite(timestamp) || timestamp >= Date.now() - rangeStart;
  };
  const visible = intelligence.filter((signal) => {
    const text = `${signal.title} ${signal.summary} ${signal.source}`.toLocaleLowerCase();
    const signalLanguage = signal.language ?? detect(`${signal.title} ${signal.summary}`);
    return isWithinRange(signal.publishedAt) && (category === 'ALL' || signal.category === category) && (source === 'ALL' || signal.source === source) && (language === 'ALL' || signalLanguage === language) && (!query.trim() || text.includes(query.trim().toLocaleLowerCase()));
  });
  const selected = visible.find((signal) => signal.id === item?.id) ?? visible[0];
  const sourceLabel = (signal: LocalState['intelligence'][number]) => signal.captureMethod === 'SEARCH' ? '网页检索' : signal.captureMethod === 'MANUAL_LINK' ? '链接剪藏' : signal.source;
  const projectTitles = useMemo(() => new Set(projects.map((project) => project.title)), [projects]);
  const projectSourceIds = useMemo(() => new Set(topics.filter((topic) => topic.status === 'PROJECT_CREATED' && projectTitles.has(topic.title)).flatMap((topic) => topic.sourceIds)), [topics, projectTitles]);
  const categoryTone = (value: string) => {
    const tones = ['tag-blue', 'tag-mint', 'tag-yellow', 'tag-coral'];
    return tones[[...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length];
  };
  const sourceTone = (value: string) => {
    const tones = ['source-blue', 'source-mint', 'source-yellow', 'source-coral'];
    const index = sourceNames.indexOf(value);
    return tones[(index < 0 ? 0 : index) % tones.length];
  };
  const keywordTags = (signal: LocalState['intelligence'][number]) => {
    const configured = configuredSources.find((source) => source.name === signal.source);
    const text = `${signal.title} ${signal.summary}`.toLocaleLowerCase();
    return (configured?.includeKeywords ?? []).filter((keyword) => text.includes(keyword.toLocaleLowerCase())).slice(0, 2);
  };
  const displayTime = (value: string) => {
    if (value === '刚刚' || value === '昨天') return value;
    const timestamp = new Date(value).valueOf();
    if (!Number.isFinite(timestamp)) return value;
    const date = new Date(timestamp);
    const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    const dayKey = (target: Date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).format(target);
    if (dayKey(date) === dayKey(new Date())) return `今天 ${time}`;
    if (dayKey(date) === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) return `昨天 ${time}`;
    const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(date);
    return `${day} ${time}`;
  };
  return <>
  <PageHeader eyebrow="DISCOVER / 情报收件箱" title="热点情报" />
  <div className="discover-filters"><select className="source-filter-select" aria-label="按来源筛选" value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">全部来源</option>{sourceNames.map((value) => <option key={value} value={value}>{value}</option>)}</select><div className="time-filters" aria-label="时间筛选"><button className={timeRange === 'DAY' ? 'active' : ''} onClick={() => setTimeRange('DAY')}>24 小时</button><button className={timeRange === 'WEEK' ? 'active' : ''} onClick={() => setTimeRange('WEEK')}>7 天</button><button className={timeRange === 'MONTH' ? 'active' : ''} onClick={() => setTimeRange('MONTH')}>30 天</button></div><select aria-label="按题材筛选" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">全部题材</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="按语言筛选" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="ALL">全部语言</option><option value="zh">中文</option><option value="en">英文</option></select><label className="model-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索情报" /></label><button className="button primary" onClick={onRefresh} disabled={refreshFeedback.status === 'running'}><RefreshCw className={refreshFeedback.status === 'running' ? 'spin' : ''} size={15}/>{refreshFeedback.status === 'running' ? '正在刷新' : '刷新热点'}</button></div>
  {refreshFeedback.status !== 'idle' && <div className={`refresh-feedback ${refreshFeedback.status}`} role="status"><span>{refreshFeedback.status === 'running' ? '…' : refreshFeedback.status === 'success' ? '✓' : refreshFeedback.status === 'error' ? '!' : 'i'}</span>{refreshFeedback.message}</div>}
  {!selected ? <section className="utility"><h2>没有匹配的情报</h2></section> : <div className="discover-layout"><section className="signal-list" aria-label="情报列表">{visible.map((signal) => <button key={signal.id} className={`signal ${signal.id === selected.id ? 'selected' : ''}`} onClick={() => onSelect(signal.id)}><header className={`signal-head ${sourceTone(sourceLabel(signal))}`}><span className="signal-source">{sourceLabel(signal)}</span>{projectSourceIds.has(signal.id) && <span className="projected-mark">已立项</span>}</header><b>{signal.title}</b><p>{signal.summary}</p><footer><span className="signal-tags"><em className={`signal-topic ${categoryTone(signal.category || '未分类')}`}>{signal.category || '未分类'}</em>{keywordTags(signal).map((keyword) => <em key={keyword} className={`keyword-tag ${categoryTone(keyword)}`}>{keyword}</em>)}{signal.analysis && <em className="heat-mark">{signal.heat}</em>}</span><small>{displayTime(signal.publishedAt)}</small></footer></button>)}</section><aside className="detail-drawer"><span className="chip blue">已选中</span><h2>{selected.title}</h2><div className="drawer-meta"><span>{sourceLabel(selected)}</span><span>{selected.category || '未分类'}</span><span>{displayTime(selected.publishedAt)}</span></div><p>{selected.summary}</p>{selected.analysis && <div className="idea"><b>建议角度</b><br/>{selected.analysis.suggestedAngle}</div>}{selected.analysis?.factsToVerify.length ? <p className="fact-checks">待核验：{selected.analysis.factsToVerify.join('；')}</p> : null}{selected.url ? <a className="source-link" href={selected.url} target="_blank" rel="noreferrer">打开原文 ↗</a> : <p className="source-link">来源：{selected.source}</p>}{analysisFeedback.status === 'error' && <p className="form-error">{analysisFeedback.message}</p>}<footer><button className="text-button" disabled={analysisFeedback.status === 'running'} onClick={onAnalyze}>{analysisFeedback.status === 'running' ? '分析中' : 'AI 分析'}</button><button className="button primary" onClick={onCreateTopic}>创建选题</button></footer></aside></div>}
  </>;
}

function LegacyDiscover({ item, intelligence, onSelect, onCreateTopic, onRefresh, refreshFeedback, analysisFeedback, onAnalyze }: { item: LocalState['intelligence'][number]; intelligence: LocalState['intelligence']; onSelect: (id: string) => void; onCreateTopic: () => void; onRefresh: () => void; refreshFeedback: { status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string }; analysisFeedback: { status: 'idle' | 'running' | 'error'; message: string }; onAnalyze: () => void }) { return <>
  <PageHeader eyebrow="DISCOVER / 热点情报" title="今日热点" />
  <div className="filter-row"><div>{['全部','AI','财经','历史','人文','国学'].map((label,index) => <button key={label} className={`filter ${index === 0 ? 'active' : ''}`}>{label}</button>)}<span className="filter-note">近 7 天</span></div><button className="button primary" onClick={onRefresh} disabled={refreshFeedback.status === 'running'}><RefreshCw className={refreshFeedback.status === 'running' ? 'spin' : ''} size={15}/>{refreshFeedback.status === 'running' ? '正在刷新' : '刷新热点'}</button></div>
  {refreshFeedback.status !== 'idle' && <div className={`refresh-feedback ${refreshFeedback.status}`} role="status"><span>{refreshFeedback.status === 'running' ? '…' : refreshFeedback.status === 'success' ? '✓' : refreshFeedback.status === 'error' ? '!' : 'i'}</span>{refreshFeedback.message}</div>}
  <div className="discover-layout"><section className="signal-list">{intelligence.map((signal) => <button key={signal.id} className={`signal ${signal.id === item.id ? 'selected' : ''}`} onClick={() => onSelect(signal.id)}><span className="signal-icon">{signal.category === 'AI' ? '⌘' : signal.category === '财经' ? '↗' : '▤'}</span><span><b>{signal.title}</b><p>{signal.summary}</p><small>{signal.publishedAt} · {signal.category} · {signal.source}</small></span><span><em className={`chip ${signal.trust === '可信' ? 'mint' : 'yellow'}`}>{signal.trust}</em><em className="chip">{signal.analysis ? `${signal.heat} 热度` : '未评分'}</em></span></button>)}</section>
  <aside className="detail-drawer"><span className="chip blue">已选中热点</span><h2>{item.title}</h2><p>{item.summary}</p>{item.analysis && <div className="idea"><b>建议角度</b><br/>{item.analysis.suggestedAngle}</div>}{item.analysis?.factsToVerify.length ? <p className="fact-checks">待核验：{item.analysis.factsToVerify.join('；')}</p> : null}{item.url ? <a className="source-link" href={item.url} target="_blank" rel="noreferrer">打开原文 ↗</a> : <p className="source-link">来源：{item.source}</p>}{analysisFeedback.status === 'error' && <p className="form-error">{analysisFeedback.message}</p>}<footer><button className="text-button" disabled={analysisFeedback.status === 'running'} onClick={onAnalyze}>{analysisFeedback.status === 'running' ? '分析中' : 'AI 分析'}</button><button className="button primary" onClick={onCreateTopic}>创建选题</button></footer></aside></div>
  </>; }

function LinkClipEditor({ onSave, onCancel }: { onSave: (item: Omit<LocalState['intelligence'][number], 'id'>) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('其它');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const preview = async () => {
    setLoading(true); setError('');
    try {
      const result = await previewPublicLink(url);
      setUrl(result.url); setTitle(result.title); setSummary(result.summary); setSource(result.source); setCategory(result.category); setKeywords(result.keywords);
    } catch (error) { setError(displayError(error, '读取链接失败。')); }
    finally { setLoading(false); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { new URL(url); } catch { setError('请输入有效链接。'); return; }
    if (!title.trim()) { setError('请先读取链接或补充文章标题。'); return; }
    onSave({ title: title.trim(), summary: summary.trim() || '用户主动剪藏，待补充摘要。', source: source.trim() || '手工剪藏', category: category.trim() || '其它', keywords, publishedAt: '刚刚', heat: 0, trust: '待核验', url: url.trim(), note: note.trim(), captureMethod: 'MANUAL_LINK' });
  };
  return <section className="topic-editor-page"><div className="editor-page-head"><div><div className="eyebrow">DISCOVER / 链接剪藏</div><h1 className="page-title">收藏链接</h1></div><button className="text-button" onClick={onCancel}>返回热点</button></div><form className="topic-form" onSubmit={submit}><label className="form-title">原文链接<div className="link-input-row"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="公众号、X、今日头条或公开网页链接" autoFocus /><button type="button" className="button" disabled={loading || !url.trim()} onClick={() => void preview()}>{loading ? '读取中' : '读取链接'}</button></div></label><div className="form-grid"><label>文章标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>来源<input value={source} onChange={(event) => setSource(event.target.value)} /></label></div><label>摘要<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} /></label><div className="form-grid"><label>归属题材<input value={category} onChange={(event) => setCategory(event.target.value)} /></label><label>收藏备注<input value={note} onChange={(event) => setNote(event.target.value)} /></label></div>{error && <p className="form-error">{error}</p>}<footer><button className="text-button" type="button" onClick={onCancel}>取消</button><button className="button primary" type="submit">保存到热点池 <ChevronRight size={17}/></button></footer></form></section>;
}

function LegacyLinkClipEditor({ onSave, onCancel }: { onSave: (item: Omit<LocalState['intelligence'][number], 'id'>) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [source, setSource] = useState(''); const [summary, setSummary] = useState(''); const [category, setCategory] = useState('未分类'); const [note, setNote] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const preview = async () => {
    if (!window.contentEngine) { setError('请在桌面端读取链接。'); return; }
    setLoading(true); setError('');
    try { const result = await window.contentEngine.intelligence.previewLink(url); setUrl(result.url); setTitle(result.title); setSummary(result.summary); setSource(result.source); }
    catch (error) { setError(displayError(error, '读取链接失败。')); }
    finally { setLoading(false); }
  };
  const submit = (event: React.FormEvent) => { event.preventDefault(); try { new URL(url); } catch { setError('请输入有效链接。'); return; } if (!title.trim()) { setError('请补充文章标题。'); return; } onSave({ title:title.trim(), summary:summary.trim() || '用户主动剪藏，待补充摘要。', source:source.trim() || '手工剪藏', category:category.trim() || '未分类', publishedAt:'刚刚', heat:0, trust:'待核验', url:url.trim(), note:note.trim(), captureMethod:'MANUAL_LINK' }); };
  return <section className="topic-editor-page"><div className="editor-page-head"><div><div className="eyebrow">DISCOVER / 链接剪藏</div><h1 className="page-title">收藏一篇值得研究的文章</h1><p className="page-subtitle">适用于公众号文章、公开网页和报告链接。系统不会绕过登录、付费墙或访问限制。</p></div><button className="text-button" onClick={onCancel}>返回热点</button></div><form className="topic-form" onSubmit={submit}><label className="form-title">原文链接<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴公众号文章或公开网页链接" autoFocus /></label><div className="form-grid"><label>文章标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="从原文复制标题" /></label><label>来源 / 公众号名<input value={source} onChange={(event) => setSource(event.target.value)} /></label></div><label>摘要或核心内容<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} placeholder="粘贴文章摘要、关键段落或你的理解。" /></label><div className="form-grid"><label>归属题材<input value={category} onChange={(event) => setCategory(event.target.value)} /></label><label>收藏备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="为什么值得关注？" /></label></div>{error && <p className="form-error">{error}</p>}<footer><button className="text-button" type="button" onClick={onCancel}>取消</button><button className="button primary" type="submit">保存到热点池 <ChevronRight size={17}/></button></footer></form></section>;
}

function TopicEditor({ topic, defaultCategory, onSave, onCancel }: { topic?: TopicCandidate; defaultCategory: string; onSave: (draft: Omit<TopicCandidate, 'id' | 'status' | 'sourceIds'>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(topic?.title ?? '');
  const [category, setCategory] = useState(topic?.category ?? defaultCategory);
  const [coreViewpoint, setCoreViewpoint] = useState(topic?.coreViewpoint ?? '');
  const [urgency, setUrgency] = useState<TopicCandidate['urgency']>(topic?.urgency ?? '中');
  const [plannedDate, setPlannedDate] = useState(topic?.plannedDate ?? '');
  const [platforms, setPlatforms] = useState<Platform[]>(topic?.platforms ?? ['WECHAT', 'XIAOHONGSHU']);
  const togglePlatform = (platform: Platform) => setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !coreViewpoint.trim() || platforms.length === 0) return;
    onSave({ title: title.trim(), category: category.trim() || '未分类', coreViewpoint: coreViewpoint.trim(), urgency, plannedDate: plannedDate.trim() || undefined, platforms });
  };
  return <section className="topic-editor-page">
    <div className="editor-page-head"><div><div className="eyebrow">PLAN / 选题编辑</div><h1 className="page-title">{topic ? '修改选题' : '建立一个好选题'}</h1><p className="page-subtitle">先把观点说清楚，后续文案、视觉和视频才能准确展开。</p></div><button className="text-button" onClick={onCancel}>取消并返回</button></div>
    <form className="topic-form" onSubmit={submit}>
      <label className="form-title">选题标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="一句话描述这期要解决的问题" autoFocus /></label>
      <div className="form-grid"><label>题材<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：国学生活化" /></label><label>时效<select value={urgency} onChange={(event) => setUrgency(event.target.value as TopicCandidate['urgency'])}><option value="高">高：需要尽快跟进</option><option value="中">中：常规排期</option><option value="低">低：常青内容</option></select></label></div>
      <label>核心观点<textarea value={coreViewpoint} onChange={(event) => setCoreViewpoint(event.target.value)} placeholder="你希望读者看完后认同或能做到什么？" rows={5} /></label>
      <fieldset><legend>目标平台</legend><div className="platform-options">{(['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'] as Platform[]).map((platform) => <button type="button" key={platform} className={platforms.includes(platform) ? 'chosen' : ''} onClick={() => togglePlatform(platform)}>{platforms.includes(platform) ? '✓ ' : '+ '}{platformName[platform]}</button>)}</div></fieldset>
      <label>计划日期 <span>（可选）</span><input value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} placeholder="例如：2026-07-25" /></label>
      <footer><button className="text-button" type="button" onClick={onCancel}>取消</button><button className="button primary" type="submit" disabled={!title.trim() || !coreViewpoint.trim() || platforms.length === 0}>保存选题 <ChevronRight size={17}/></button></footer>
    </form>
  </section>;
}

function Plan({ topics, selected, onSelect, onCreateProject, onEdit, onDelete }: { topics: LocalState['topics']; selected: LocalState['topics'][number]; onSelect: (id: string) => void; onCreateProject: () => void; onEdit: (topic: TopicCandidate) => void; onDelete: (topic: TopicCandidate) => void }) { return <>
  <PageHeader eyebrow="PLAN / 内容规划" title="选题池" subtitle="从热点里选择值得投入制作成本的内容。" />
  <div className="plan-layout"><section><div className="filter-row slim"><div>{['全部','AI 工具实战','财经政策解读','历史人文'].map((label,index) => <button key={label} className={`filter ${index === 0 ? 'active' : ''}`}>{label}</button>)}</div></div><table><thead><tr><th>选题</th><th>题材</th><th>目标平台</th><th>时效</th><th>状态</th><th>计划日期</th></tr></thead><tbody>{topics.map((topic) => <tr key={topic.id} className={topic.id === selected.id ? 'selected-row' : ''} onClick={() => onSelect(topic.id)}><td>{topic.title}</td><td>{topic.category}</td><td>{topic.platforms.map((platform) => platformName[platform]).join(' / ')}</td><td>{topic.urgency}</td><td><span className="chip yellow">{topic.status === 'PENDING' ? '待判断' : topic.status === 'ACCEPTED' ? '已采纳' : '已立项'}</span></td><td>{topic.plannedDate ?? '未安排'}</td></tr>)}</tbody></table></section><aside className="topic-detail"><h2>选题详情</h2><DetailBlock label="核心观点" value={selected.coreViewpoint}/><DetailBlock label="目标受众" value="新中产职场人、AI 工具爱好者"/><DetailBlock label="关联热点" value="#视频生成 #创作者工具 #工作流"/><DetailBlock label="执行备注" value="补充 2 个真实案例，避免只讲提示词。"/><div className="topic-detail-actions"><button className="text-button" onClick={() => onEdit(selected)}>编辑</button><button className="text-button danger" onClick={() => onDelete(selected)}>删除</button></div><button className="button primary wide" onClick={onCreateProject}>确认立项</button></aside></div>
  </>; }

function DetailBlock({ label, value }: { label: string; value: string }) { return <div className="detail-block"><small>{label}</small><p>{value}</p></div>; }

function Create({ project, activePlatform, onPlatform, activeVersion, progress, onSaveVersion }: { project: ContentProject | undefined; activePlatform: Platform; onPlatform: (platform: Platform) => void; activeVersion: ContentVersion | undefined; progress: number; onSaveVersion: (projectId: string, versionId: string, patch: Pick<ContentVersion, 'title' | 'body'>) => void }) {
  const [draft, setDraft] = useState<Pick<ContentVersion, 'title' | 'body'>>({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');

  useEffect(() => {
    setDraft({ title: activeVersion?.title ?? '', body: activeVersion?.body ?? '' });
    setSaveState('saved');
  }, [activeVersion?.id]);

  const changeDraft = (patch: Partial<Pick<ContentVersion, 'title' | 'body'>>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState('saving');
  };
  useEffect(() => {
    if (saveState !== 'saving' || !project || !activeVersion) return;
    const timer = window.setTimeout(() => {
      onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
      setSaveState('saved');
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeVersion?.id, draft, project?.id, saveState]);
  const save = () => {
    if (!project || !activeVersion) return;
    onSaveVersion(project.id, activeVersion.id, { title: draft.title.trim() || '未命名草稿', body: draft.body });
    setSaveState('saved');
  };

  if (!project || !activeVersion) return <section className="empty-workbench"><h1>还没有可编辑的平台版本</h1><p>请先从选题池确认立项，系统会按目标平台创建草稿。</p></section>;
  return <>
    <div className="project-heading"><div><div className="eyebrow">CREATE / 内容项目</div><h1 className="page-title">{project.title}</h1><p className="page-subtitle">项目编号 {project.id.slice(-6).toUpperCase()} · {projectStatusName[project.status]}</p></div><span className={`chip ${saveState === 'saving' ? 'yellow' : 'mint'}`}>{saveState === 'saving' ? '正在编辑' : `已保存 ${activeVersion.updatedAt}`}</span></div>
    <div className="stepper">{['策划','写作','视觉','视频','审核'].map((label,index) => <div className={`step ${index === 0 ? 'done' : index === 1 ? 'current' : ''}`} key={label}><b>{index === 0 ? '✓' : index + 1}</b><span>{label}</span></div>)}</div>
    <div className="create-layout editable"><section className="editor"><div className="editor-head"><div className="tabs">{project.versions.map((version) => <button key={version.platform} className={version.platform === activePlatform ? 'active' : ''} onClick={() => onPlatform(version.platform)}>{platformName[version.platform]}</button>)}</div><button className="text-button" onClick={save}>保存草稿</button></div><div className="editor-tools">内容版本 · {platformName[activeVersion.platform]} · 文本草稿</div><div className="document editor-document"><label>标题<input value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })} onBlur={save} /></label><label>正文<textarea value={draft.body} onChange={(event) => changeDraft({ body: event.target.value })} onBlur={save} placeholder="从核心观点开始，写出这期内容的完整表达。" /></label></div></section><aside className="assistant-panel"><h2>创作检查</h2><div className="assist-card"><b>平台版本</b><p>{project.versions.length} 个目标平台版本已创建，可分别编辑。</p></div><div className="assist-card"><b>事实核验</b><p>{project.factChecks.length ? `还有 ${project.factChecks.length} 项待确认` : '尚未添加待核验事项'}</p></div><div className="assist-card"><b>下一步</b><p>完成正文后进入视觉制作，补齐封面和图文素材。</p></div></aside></div>
  </>;
}

function LegacyCreate({ project, activePlatform, onPlatform, activeVersion, progress }: { project: ContentProject | undefined; activePlatform: Platform; onPlatform: (platform: Platform) => void; activeVersion: ReturnType<ContentProject['versions']['find']>; progress: number }) { if (!project) return null; return <>
  <div className="project-heading"><div><div className="eyebrow">CREATE / 内容项目</div><h1 className="page-title">{project.title}</h1><p className="page-subtitle">项目编号 PROJ-9024 · {projectStatusName[project.status]}</p></div><span className="chip blue">已完成 {progress} / 3 个版本预检</span></div>
  <div className="stepper">{['策划','写作','视觉','视频','审核'].map((label,index) => <div className={`step ${index < 2 ? 'done' : index === 2 ? 'current' : ''}`} key={label}><b>{index < 2 ? '✓' : index + 1}</b><span>{label}</span></div>)}</div>
  <div className="create-layout"><section className="editor"><div className="editor-head"><div className="tabs">{(['WECHAT','XIAOHONGSHU','VIDEO_CHANNEL'] as Platform[]).map((platform) => <button key={platform} className={platform === activePlatform ? 'active' : ''} onClick={() => onPlatform(platform)}>{platformName[platform]}</button>)}</div><span className="chip yellow">草稿已保存</span></div><div className="editor-tools">H1　H2　<b>B</b>　<i>I</i>　☷　＋ 插入素材</div><article className="document"><h1>{activeVersion?.title}</h1><div className="lead">{activeVersion?.body}</div><p>很多人把 AI 视频理解成一个“点一下就出片”的工具，但真正决定内容质量的是选题、脚本、视觉和发布复盘能否连成工作流。</p><h2>第一步：先找到真实问题</h2><p>先明确谁会为这个主题停下来，而不是直接让模型写一篇泛泛的介绍。</p><img src="https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=900&q=80" alt="内容创作工作台"/><small>图：内容创作工作流示意</small></article></section><aside className="assistant-panel"><h2>AI 辅助</h2><div className="assist-card warning"><b>待核验事实</b><p>确认视频工具订阅价格是否仍为当前版本。</p><button className="link-button">查看来源</button></div><div className="assist-card"><b>下一步建议</b><p>将第二节压缩为 3 个可操作步骤，适合小红书分页。</p><button className="link-button">应用建议</button></div><div className="assist-card"><b>版本状态</b><p>{activeVersion?.updatedAt} 更新 · {activeVersion?.status}</p></div></aside></div>
  </>; }

function Publish({ project, onNavigate }: { project: ContentProject | undefined; onNavigate: (view: View) => void }) { return <>
  <PageHeader eyebrow="PUBLISH / 发布中心" title="内容日历" subtitle="先安排发布时间，再进入独立的发布审核。" />
  <div className="publish-layout"><section><div className="filter-row slim"><div><button className="filter active">本周</button><button className="filter">公众号</button><button className="filter">小红书</button><button className="filter">视频号</button></div></div><div className="calendar-grid">{['周一 21','周二 22','周三 23','周四 24','周五 25','周六 26','周日 27'].map((day,index) => <div className="calendar-day" key={day}><b>{day}</b>{index === 1 && <div className="calendar-post">小红书：Notion AI 教程下集</div>}{index === 2 && <div className="calendar-post red">待审核：{project?.title}</div>}{index === 4 && <div className="calendar-post mint">公众号：AIGC 行业周报</div>}</div>)}</div></section><aside className="publish-review"><span className="chip yellow">待发布审核</span><h2>{project?.title}</h2><img src="https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80" alt="发布封面预览"/><p><b>小红书 · 图文 8 页</b><br/><small>计划：7 月 23 日 18:30</small></p><ul><li><CheckCircle2 size={16}/>标题与封面已确认</li><li><CheckCircle2 size={16}/>图片比例符合平台要求</li><li className="pending">! 有 1 条事实待确认</li></ul><button className="button primary wide" onClick={() => onNavigate('create')}>进入发布审核 →</button></aside></div>
  </>; }

function Review({ onNavigate }: { onNavigate: (view: View) => void }) { return <>
  <PageHeader eyebrow="REVIEW / 数据复盘" title="什么内容值得继续做？" subtitle="近 30 天 · 全部账号 · 以可复用结论为目标。" />
  <div className="review-layout"><section className="chart-panel"><h2>栏目表现</h2>{[['国学生活化',88,'blue'],['AI 工具实战',71,'yellow'],['财经政策解读',56,'mint'],['历史人物',39,'red']].map(([label,value,color]) => <div className="bar" key={String(label)}><span>{label}</span><div><i className={String(color)} style={{width:`${value}%`}}/></div><b>{value}</b></div>)}<div className="editorial-rule compact"/><h2>本周期表现最佳</h2><p><b>《国学里的情绪管理》</b><br/>小红书收藏率 14.8% · 视频号完播率 42%</p></section><aside className="insight-panel"><span className="chip mint">可执行结论</span><h2>继续做“国学生活化”系列</h2><p>这个栏目在小红书的收藏率最高。建议下一期围绕“职场焦虑”和“关系边界”两个现代场景，将视频号口播控制在 45-60 秒。</p><button className="text-button" onClick={() => onNavigate('plan')}>创建系列选题 →</button></aside></div>
  </>; }

const modelProviders: { provider: ModelProvider; label: string; detail: string; baseUrl: string; model: string }[] = [
  { provider: 'DASHSCOPE', label: '阿里云百炼', detail: '通义千问兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { provider: 'SILICONFLOW', label: '硅基流动', detail: '模型聚合与推理服务', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B' },
  { provider: 'VOLCENGINE_ARK', label: '火山方舟', detail: '填写你的接入点模型 ID', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '你的接入点 ID' },
  { provider: 'KIMI', label: 'Kimi', detail: 'Moonshot AI 接口', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { provider: 'ZHIPU', label: '智谱 AI', detail: 'GLM 系列兼容接口', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { provider: 'OPENAI', label: 'OpenAI', detail: '官方 API', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { provider: 'OPENAI_COMPATIBLE', label: '自定义兼容接口', detail: '适用于 OpenAI 兼容服务', baseUrl: 'https://api.example.com/v1', model: '填写模型名称' },
];

const modelPurposeNames = {
  INTELLIGENCE_SUMMARY: '热点摘要',
  INTELLIGENCE_FILTER: '资讯筛选',
  TOPIC_RECOMMENDATION: '选题推荐',
  CONTENT_WRITING: '后续创作',
} as const;

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

function LegacyModelConnectionScreen() {
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [draft, setDraft] = useState<ModelDraft>(() => draftForProvider('DASHSCOPE'));
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const animationRoot = useRef<HTMLDivElement>(null);

  const loadConnections = () => void window.contentEngine?.models.list().then(setConnections).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取模型连接失败。' }));
  useEffect(loadConnections, []);
  useEffect(() => {
    if (!animationRoot.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scope = createScope({ root: animationRoot }).add(() => {
      animate('.model-form-step', { opacity: { from: 0 }, y: { from: 12 }, duration: 360, delay: stagger(65), ease: 'outQuad' });
    });
    return () => scope.revert();
  }, [draft.provider]);

  const selectProvider = (provider: ModelProvider) => { setDraft(draftForProvider(provider)); setNotice(null); };
  const editConnection = (connection: ModelConnection) => { setDraft({ ...connection, apiKey: '' }); setNotice(null); };
  const saveConnection = async () => {
    if (!window.contentEngine) throw new Error('请在桌面端中配置模型连接。');
    if (!draft.apiKey.trim() && !draft.id) throw new Error('请输入 API Key。');
    const saved = await window.contentEngine.models.save({ ...draft, apiKey: draft.apiKey.trim() || undefined });
    setConnections((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setDraft((current) => ({ ...current, id: saved.id, apiKey: '' }));
    return saved;
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('saving'); setNotice(null);
    try { await saveConnection(); setNotice({ type: 'success', text: '已加密保存到本机。现在可以进行连通性检查。' }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存模型连接失败。' }); }
    finally { setBusy('idle'); }
  };
  const test = async () => {
    setBusy('testing'); setNotice(null);
    try {
      const saved = await saveConnection();
      const tested = await window.contentEngine!.models.test(saved.id);
      setConnections((current) => [tested, ...current.filter((item) => item.id !== tested.id)]);
      setNotice(tested.status === 'READY' ? { type: 'success', text: `连接可用，已于 ${tested.lastTestedAt} 完成检查。` } : { type: 'error', text: tested.lastError || '连接检查未通过，请核对地址、模型名称和 API Key。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '连接检查失败。' }); }
    finally { setBusy('idle'); }
  };
  const remove = async (connection: ModelConnection) => {
    if (!window.confirm(`确定移除“${connection.label}”连接吗？本机保存的 API Key 也会一并删除。`)) return;
    try {
      await window.contentEngine?.models.remove(connection.id);
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      if (draft.id === connection.id) setDraft(draftForProvider('DASHSCOPE'));
      setNotice({ type: 'success', text: '模型连接已移除。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '移除模型连接失败。' }); }
  };
  const togglePurpose = (purpose: keyof typeof modelPurposeNames) => setDraft((current) => ({ ...current, purposes: current.purposes.includes(purpose) ? current.purposes.filter((item) => item !== purpose) : [...current.purposes, purpose] }));

  return <div ref={animationRoot} className="model-settings"><PageHeader eyebrow="SETTINGS / 模型与 API" title="接入你的 AI 服务" subtitle="先连接一个模型，用于热点摘要、筛选和选题推荐。API Key 仅加密保存在这台电脑。" />
    <section className="model-provider-stage model-form-step"><div className="section-intro"><h2>1. 选择服务商</h2><p>已预填常用兼容地址和示例模型，你仍可按自己的账号与接入点修改。</p></div><div className="provider-grid">{modelProviders.map((item) => <button type="button" key={item.provider} className={`provider-card ${draft.provider === item.provider ? 'selected' : ''}`} onClick={() => selectProvider(item.provider)}><b>{item.label}</b><small>{item.detail}</small></button>)}</div></section>
    <div className="model-connection-layout"><form className="model-form model-form-step" onSubmit={save}><div className="model-form-heading"><div><h2>2. 配置并测试</h2><p>{draft.id ? '正在编辑已保存连接。留空 API Key 即保留原密钥。' : '填写完成后，先保存或直接进行连通性检查。'}</p></div><span className="chip blue"><ShieldCheck size={13}/>本机加密</span></div><label>连接名称<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="例如：我的通义主力模型" /></label><div className="model-form-grid"><label>API 地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://.../v1" /></label><label>模型名称<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="例如：qwen-plus" /></label></div><label>API Key<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.id ? '留空表示不修改已保存的密钥' : '粘贴 API Key'} autoComplete="off" /></label><fieldset><legend>用于哪些工作</legend><div className="purpose-grid">{(Object.keys(modelPurposeNames) as (keyof typeof modelPurposeNames)[]).map((purpose) => <label className="purpose-option" key={purpose}><input type="checkbox" checked={draft.purposes.includes(purpose)} onChange={() => togglePurpose(purpose)} />{modelPurposeNames[purpose]}</label>)}</div></fieldset>{notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}<footer><button className="button" type="button" disabled={busy !== 'idle'} onClick={test}><KeyRound size={16}/>{busy === 'testing' ? '检查中' : '保存并检查'}</button><button className="button primary" type="submit" disabled={busy !== 'idle'}>{busy === 'saving' ? '保存中' : '加密保存'}</button></footer><small>连通性检查仅请求服务商的模型目录，不会生成内容或产生模型调用费用。</small></form>
      <aside className="saved-connections model-form-step"><div className="panel-head"><h2>已保存连接</h2><span className="chip mint">{connections.length} 个</span></div>{connections.length === 0 ? <div className="model-empty"><KeyRound size={22}/><b>还没有连接</b><p>建议先接入一个文本模型，后续热点智能筛选才会启用。</p></div> : <div className="connection-list">{connections.map((connection) => <article className="connection-row" key={connection.id}><button type="button" className="connection-main" onClick={() => editConnection(connection)}><span className={`connection-status ${connection.status.toLowerCase()}`} /><span><b>{connection.label}</b><small>{connection.model}</small></span></button><button type="button" className="connection-remove" aria-label={`移除 ${connection.label}`} onClick={() => remove(connection)}><Trash2 size={16}/></button></article>)}</div>}<p className="connection-help">绿色为已检查可用，黄色为尚未检查，红色为上次检查失败。点击连接可继续编辑。</p></aside></div>
  </div>;
}

const externalModelProviders = modelProviders.filter((provider) => provider.provider !== 'DASHSCOPE');
const providerLabels: Record<ModelProvider, string> = { DASHSCOPE: '阿里云百炼', SILICONFLOW: '硅基流动', VOLCENGINE_ARK: '火山方舟', KIMI: 'Kimi', ZHIPU: '智谱 AI', OPENAI: 'OpenAI', OPENAI_COMPATIBLE: '自定义兼容接口' };
const bailianScopes: { id: BailianCapabilityScope; label: string; icon: typeof BrainCircuit }[] = [
  { id: 'AUTO', label: '自动选择', icon: BrainCircuit },
  { id: 'TEXT', label: '文字研究', icon: PenLine },
  { id: 'IMAGE', label: '视觉素材', icon: Image },
  { id: 'AUDIO', label: '语音能力', icon: AudioLines },
  { id: 'VIDEO', label: '视频能力', icon: Video },
];
const emptyBailianStatus: BailianCliStatus = { installed: false, configured: false, scope: 'AUTO', status: 'UNCONFIGURED' };

function LegacyModelSettingsScreen() {
  const [screen, setScreen] = useState<'bailian' | 'connections' | 'editor'>('bailian');
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [bailian, setBailian] = useState<BailianCliStatus>(emptyBailianStatus);
  const [editing, setEditing] = useState<ModelConnection | undefined>();
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadConnections = () => void window.contentEngine?.models.list().then(setConnections).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取外部 API 连接失败。' }));
  const loadBailian = () => void window.contentEngine?.bailian.status().then(setBailian).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取百炼 CLI 状态失败。' }));
  useEffect(() => { loadConnections(); loadBailian(); }, []);
  const openNew = () => { setEditing(undefined); setNotice(null); setScreen('editor'); };
  const openEdit = (connection: ModelConnection) => { setEditing(connection); setNotice(null); setScreen('editor'); };
  const saveExternal = async (input: ModelConnectionInput) => {
    if (!window.contentEngine) throw new Error('请在桌面端中配置 API 连接。');
    const saved = await window.contentEngine.models.save(input);
    setConnections((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  };
  const testExternal = async (input: ModelConnectionInput) => {
    const saved = await saveExternal(input);
    const tested = await window.contentEngine!.models.test(saved.id);
    setConnections((current) => [tested, ...current.filter((item) => item.id !== tested.id)]);
    return tested;
  };
  const deleteExternal = async (connection: ModelConnection) => {
    if (!window.confirm(`确定移除“${connection.label}”吗？本机保存的 API Key 也会一并删除。`)) return;
    await window.contentEngine?.models.remove(connection.id);
    setConnections((current) => current.filter((item) => item.id !== connection.id));
  };
  const saveBailian = async (input: { apiKey?: string; scope: BailianCapabilityScope }) => {
    if (!window.contentEngine) throw new Error('请在桌面端中配置百炼 CLI。');
    const status = await window.contentEngine.bailian.save(input);
    setBailian(status); return status;
  };
  const testBailian = async () => {
    if (!window.contentEngine) throw new Error('请在桌面端中检查百炼 CLI。');
    try {
      const status = await window.contentEngine.bailian.test();
      setBailian(status); return status;
    } finally {
      void window.contentEngine.bailian.status().then(setBailian).catch(() => undefined);
    }
  };
  const removeBailian = async () => {
    if (!window.confirm('确定移除百炼 API Key 吗？CLI 程序会保留，但不能再调用模型能力。')) return;
    await window.contentEngine?.bailian.remove(); setBailian({ ...emptyBailianStatus, installed: bailian.installed, version: bailian.version });
  };

  if (screen === 'editor') return <ExternalApiEditor key={editing?.id ?? 'new'} connection={editing} onBack={() => setScreen('connections')} onSave={saveExternal} onTest={testExternal} />;
  return <div className="ai-settings"><PageHeader eyebrow="SETTINGS / AI 能力与连接" title={screen === 'bailian' ? '百炼能力中心' : '外部 API 连接'} subtitle={screen === 'bailian' ? '配置能力范围与访问凭证。' : '管理补充模型连接。'} />
    <nav className="ai-section-nav" aria-label="AI 设置分区"><button className={screen === 'bailian' ? 'active' : ''} onClick={() => setScreen('bailian')}><BrainCircuit size={18}/>百炼 CLI</button><button className={screen === 'connections' ? 'active' : ''} onClick={() => setScreen('connections')}><KeyRound size={18}/>外部 API <span>{connections.length}</span></button></nav>
    {notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}
    {screen === 'bailian' ? <BailianCliCenter status={bailian} onSave={saveBailian} onTest={testBailian} onRemove={removeBailian} /> : <ExternalApiConnections connections={connections} onNew={openNew} onEdit={openEdit} onRemove={deleteExternal} />}
  </div>;
}

const modelTaskNames: Record<ModelTask, string> = {
  INTELLIGENCE_ANALYSIS: '热点分析',
  TOPIC_RECOMMENDATION: '选题建议',
  CONTENT_WRITING: '文案生成',
  CONTENT_REWRITE: '改写与解读',
  CONTENT_LAYOUT: '公众号排版',
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

type ModelSettingsSection = 'bailian' | 'agent' | 'search' | 'connections' | 'policies' | 'usage';

const modelSettingsScreenTitles: Record<ModelSettingsSection, string> = {
  bailian: '百炼',
  agent: '核心 Agent',
  search: '检索 API',
  connections: '外部 API',
  policies: '任务策略',
  usage: '调用记录',
};

function ModelSettingsScreen() {
  const [screen, setScreen] = useState<ModelSettingsSection | 'editor'>('bailian');
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [bailian, setBailian] = useState<BailianCliStatus>(emptyBailianStatus);
  const [catalog, setCatalog] = useState<ModelCatalogItem[]>([]);
  const [policies, setPolicies] = useState<ModelTaskPolicy[]>([]);
  const [usage, setUsage] = useState<ApiUsageSummary>({ totalCalls: 0, todayCalls: 0, successCalls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0 });
  const [logs, setLogs] = useState<ApiUsageLog[]>([]);
  const [editing, setEditing] = useState<ModelConnection | undefined>();
  const [notice, setNotice] = useState<{ screen: ModelSettingsSection; type: 'success' | 'error'; text: string } | null>(null);
  const isDesktop = Boolean(window.contentEngine);
  const loadConnections = () => {
    const source = window.contentEngine ? window.contentEngine.models.list() : webModels.connections();
    void source.then(setConnections).catch((error) => setNotice({ screen: 'connections', type: 'error', text: error instanceof Error ? error.message : '读取外部 API 连接失败。' }));
  };
  const loadBailian = () => {
    if (window.contentEngine) { void window.contentEngine.bailian.status().then(setBailian).catch((error) => setNotice({ screen: 'bailian', type: 'error', text: error instanceof Error ? error.message : '读取百炼 CLI 状态失败。' })); }
  };
  const loadCatalog = () => { const source = window.contentEngine ? window.contentEngine.models.listCatalog() : webModels.catalog(); void source.then(setCatalog).catch(() => undefined); };
  const loadPolicies = () => {
    const source = window.contentEngine ? window.contentEngine.models.taskPolicies() : webModels.taskPolicies();
    void source.then(setPolicies).catch((error) => setNotice({ screen: 'policies', type: 'error', text: error instanceof Error ? error.message : '读取任务策略失败。' }));
  };
  const loadUsage = () => {
    if (window.contentEngine) { void window.contentEngine.models.usageSummary().then(setUsage).catch(() => undefined); void window.contentEngine.models.usageLogs().then(setLogs).catch(() => undefined); }
    else { void webModels.usage().then((result) => { setUsage(result.summary); setLogs(result.logs); }).catch(() => undefined); }
  };
  const refreshModelSettings = () => { loadConnections(); loadCatalog(); loadPolicies(); };
  useEffect(() => { loadConnections(); loadBailian(); loadCatalog(); loadPolicies(); }, []);
  const syncCatalog = async () => {
    setNotice(null);
    try {
      const result = window.contentEngine ? await window.contentEngine.models.syncCatalog() : await webModels.syncCatalog();
      setCatalog(result.items);
      setNotice(result.errors[0] ? { screen: 'policies', type: 'error', text: result.errors[0].message } : { screen: 'policies', type: 'success', text: `已同步 ${result.items.length} 个可选模型。` });
    } catch (error) { setNotice({ screen: 'policies', type: 'error', text: error instanceof Error ? error.message : '同步模型目录失败。' }); }
  };
  const saveExternal = async (input: ModelConnectionInput) => {
    const saved = window.contentEngine ? await window.contentEngine.models.save(input) : input.id ? await webModels.updateConnection(input.id, input) : await webModels.createConnection(input);
    setConnections((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  };
  const testExternal = async (input: ModelConnectionInput) => {
    const saved = await saveExternal(input);
    const tested = window.contentEngine ? await window.contentEngine.models.test(saved.id) : await webModels.testConnection(saved.id);
    setConnections((current) => [tested, ...current.filter((item) => item.id !== tested.id)]);
    return tested;
  };
  const removeExternal = async (connection: ModelConnection) => {
    if (!window.confirm(`确定移除“${connection.label}”吗？本机保存的 API Key 也会一并删除。`)) return;
    if (window.contentEngine) await window.contentEngine.models.remove(connection.id); else await webModels.removeConnection(connection.id);
    setConnections((current) => current.filter((item) => item.id !== connection.id));
    refreshModelSettings();
  };
  const saveBailian = async (input: { apiKey?: string; scope: BailianCapabilityScope }) => {
    if (!window.contentEngine) throw new Error('请在桌面端中配置百炼 CLI。');
    const status = await window.contentEngine.bailian.save(input); setBailian(status); return status;
  };
  const testBailian = async () => {
    if (!window.contentEngine) throw new Error('请在桌面端中检查百炼 CLI。');
    try { const status = await window.contentEngine.bailian.test(); setBailian(status); return status; }
    finally { void window.contentEngine.bailian.status().then(setBailian).catch(() => undefined); }
  };
  const removeBailian = async () => {
    if (!window.confirm('确定移除百炼 API Key 吗？CLI 程序会保留，但不能再调用模型能力。')) return;
    await window.contentEngine?.bailian.remove();
    setBailian({ ...emptyBailianStatus, installed: bailian.installed, version: bailian.version });
    setCatalog((current) => current.filter((item) => item.provider !== 'BAILIAN_CLI'));
  };
  const savePolicy = async (policy: ModelTaskPolicy) => {
    const saved = window.contentEngine ? await window.contentEngine.models.saveTaskPolicy(policy) : await webModels.saveTaskPolicy(policy);
    setPolicies((current) => [saved, ...current.filter((item) => item.task !== saved.task)]);
  };
  const openSection = (next: ModelSettingsSection) => {
    setNotice(null);
    setScreen(next);
    if (next === 'usage') loadUsage();
  };
  const renderSection = () => {
    if (screen === 'bailian') return window.contentEngine ? <BailianCliCenter status={bailian} onSave={saveBailian} onTest={testBailian} onRemove={removeBailian} /> : <BailianCredentialSettings onChanged={refreshModelSettings} />;
    if (screen === 'agent') return <CoreAgentSettings catalog={catalog} onSynced={refreshModelSettings} />;
    if (screen === 'search') return <WebSearchSettings embedded onChanged={refreshModelSettings} />;
    if (screen === 'connections') return <ExternalApiConnections connections={connections} onNew={() => { setEditing(undefined); setNotice(null); setScreen('editor'); }} onEdit={(connection) => { setEditing(connection); setNotice(null); setScreen('editor'); }} onRemove={removeExternal} />;
    if (screen === 'policies') return <TaskPolicyScreen catalog={catalog} policies={policies} onSync={() => void syncCatalog()} onSave={savePolicy} />;
    return <UsageLogScreen logs={logs} />;
  };
  if (screen === 'editor') return <ExternalApiEditor key={editing?.id ?? 'new'} connection={editing} onBack={() => setScreen('connections')} onSave={saveExternal} onTest={testExternal} />;
  return <div className="ai-settings"><PageHeader eyebrow="SETTINGS / 模型与 API" title={modelSettingsScreenTitles[screen]} />
    <nav className="ai-section-nav" aria-label="模型与 API 分区"><button className={screen === 'bailian' ? 'active' : ''} onClick={() => openSection('bailian')}><BrainCircuit size={18}/>百炼</button>{!isDesktop && <><button className={screen === 'agent' ? 'active' : ''} onClick={() => openSection('agent')}><BrainCircuit size={18}/>核心 Agent</button><button className={screen === 'search' ? 'active' : ''} onClick={() => openSection('search')}><Search size={18}/>检索 API</button></>}<button className={screen === 'connections' ? 'active' : ''} onClick={() => openSection('connections')}><KeyRound size={18}/>外部 API <span>{connections.length}</span></button><button className={screen === 'policies' ? 'active' : ''} onClick={() => openSection('policies')}><Settings size={18}/>任务策略</button><button className={screen === 'usage' ? 'active' : ''} onClick={() => openSection('usage')}><ChartColumn size={18}/>调用记录</button></nav>
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

function LegacyTaskPolicyScreen({ catalog, policies, onSync, onSave }: { catalog: ModelCatalogItem[]; policies: ModelTaskPolicy[]; onSync: () => void; onSave: (policy: ModelTaskPolicy) => Promise<void> }) {
  const tasks = Object.keys(modelTaskNames) as ModelTask[];
  const [task, setTask] = useState<ModelTask>('INTELLIGENCE_ANALYSIS');
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const policy = policies.find((item) => item.task === task);
  const effectiveSelection = selection || catalog.find((item) => item.provider === policy?.provider && item.connectionId === policy?.connectionId && item.model === policy?.model)?.id || '';
  const save = async () => {
    setBusy(true);
    try {
      const selected = catalog.find((item) => item.id === effectiveSelection);
      await onSave(selected ? { task, provider: selected.provider, connectionId: selected.connectionId, model: selected.model } : { task });
    } finally { setBusy(false); }
  };
  return <section className="task-policy-layout"><aside>{tasks.map((item) => <button key={item} className={task === item ? 'active' : ''} onClick={() => { setTask(item); setSelection(''); }}><span>{modelTaskNames[item]}</span><small>{policies.find((policy) => policy.task === item)?.model ?? '未设置'}</small></button>)}</aside><div className="task-policy-editor"><div className="task-policy-head"><h2>{modelTaskNames[task]}</h2><button className="button" onClick={onSync}><RefreshCw size={16}/>同步模型</button></div><label>执行模型<select value={effectiveSelection} onChange={(event) => setSelection(event.target.value)}><option value="">不调用模型</option>{catalog.map((item) => <option value={item.id} key={item.id}>{item.connectionLabel} · {item.model}</option>)}</select></label><footer><button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中' : '保存策略'}</button></footer></div></section>;
}

const capabilityNames: Record<ModelCapability, string> = { TEXT: '文本', IMAGE: '图像生成', AUDIO: '语音合成', VIDEO: '视频生成', VISION: '视觉理解', MULTIMODAL: '全模态', ASR: '语音识别', MUSIC: '音乐生成', REASONING: '推理', EMBEDDING: '嵌入', CODE: '代码' };
const taskRequirements: Record<ModelTask, { capability: ModelCapability; operation?: ModelOperation; flow: string }> = {
  INTELLIGENCE_ANALYSIS: { capability: 'TEXT', flow: '资讯 → 分析结果' }, TOPIC_RECOMMENDATION: { capability: 'TEXT', flow: '资讯 → 选题' }, CONTENT_WRITING: { capability: 'TEXT', flow: '素材 → 文案' }, CONTENT_REWRITE: { capability: 'TEXT', flow: '原文 → 改写' }, CONTENT_LAYOUT: { capability: 'TEXT', flow: '正文 → 排版稿' },
  TEXT_TO_IMAGE: { capability: 'IMAGE', operation: 'TEXT_TO_IMAGE', flow: '文本 → 图片' }, IMAGE_TO_IMAGE: { capability: 'IMAGE', operation: 'IMAGE_TO_IMAGE', flow: '图片 + 文本 → 图片' }, SPEECH_SYNTHESIS: { capability: 'AUDIO', flow: '文本 → 音频' }, SPEECH_RECOGNITION: { capability: 'ASR', flow: '音频 / 视频 → 文本' },
  TEXT_TO_VIDEO: { capability: 'VIDEO', operation: 'TEXT_TO_VIDEO', flow: '文本 → 视频' }, IMAGE_TO_VIDEO: { capability: 'VIDEO', operation: 'IMAGE_TO_VIDEO', flow: '首帧 + 文本 → 视频' }, FIRST_LAST_FRAME_TO_VIDEO: { capability: 'VIDEO', operation: 'FIRST_LAST_FRAME_TO_VIDEO', flow: '首帧 + 尾帧 + 文本 → 视频' }, REFERENCE_TO_VIDEO: { capability: 'VIDEO', operation: 'REFERENCE_TO_VIDEO', flow: '参考图 / 视频 + 文本 → 视频' }, VIDEO_EDIT: { capability: 'VIDEO', operation: 'VIDEO_EDIT', flow: '视频 + 指令 → 视频' },
};
const modelTaskGroups: { label: string; tasks: ModelTask[] }[] = [
  { label: '情报与内容', tasks: ['INTELLIGENCE_ANALYSIS', 'TOPIC_RECOMMENDATION', 'CONTENT_WRITING', 'CONTENT_REWRITE', 'CONTENT_LAYOUT'] },
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
  return <section className="usage-log"><div className="panel-head"><h2>调用记录</h2><span className="chip">最近 80 条</span></div>{logs.length === 0 ? <p>尚无模型调用。</p> : <table><thead><tr><th>时间</th><th>功能</th><th>模型</th><th>结果</th><th>Token</th><th>耗时</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Date(log.startedAt).toLocaleString('zh-CN', { hour12: false })}</td><td>{modelTaskNames[log.task]}</td><td>{log.connectionLabel} · {log.model}</td><td><span className={`chip ${log.status === 'SUCCESS' ? 'mint' : 'red'}`}>{log.status === 'SUCCESS' ? '成功' : '失败'}</span>{log.error && <small className="usage-error">{log.error}</small>}</td><td>{log.inputTokens ?? '-'} / {log.outputTokens ?? '-'}</td><td>{(log.durationMs / 1000).toFixed(1)}s</td></tr>)}</tbody></table>}</section>;
}

function BailianCliCenter({ status, onSave, onTest, onRemove }: { status: BailianCliStatus; onSave: (input: { apiKey?: string; scope: BailianCapabilityScope }) => Promise<BailianCliStatus>; onTest: () => Promise<BailianCliStatus>; onRemove: () => Promise<void> }) {
  const [scope, setScope] = useState<BailianCapabilityScope>(status.scope);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const hasTypedKey = Boolean(apiKey.trim());
  const canUseKey = hasTypedKey || status.configured;
  const keyState = hasTypedKey ? '已输入' : status.configured ? '已保存' : '待输入';
  useEffect(() => setScope(status.scope), [status.scope]);
  const save = async () => {
    if (!canUseKey) { setNotice({ type: 'error', text: '请输入百炼 API Key。' }); keyInput.current?.focus(); return; }
    setBusy('saving'); setNotice(null);
    try { await onSave({ apiKey: apiKey.trim() || undefined, scope }); setApiKey(''); setNotice({ type: 'success', text: '百炼配置已加密保存。' }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存百炼配置失败。' }); }
    finally { setBusy('idle'); }
  };
  const test = async () => {
    if (!canUseKey) { setNotice({ type: 'error', text: '请输入百炼 API Key。' }); keyInput.current?.focus(); return; }
    setBusy('testing'); setNotice(null);
    try {
      if (apiKey.trim()) await onSave({ apiKey: apiKey.trim(), scope });
      const result = await onTest(); setApiKey('');
      if (result.status === 'READY') setNotice({ type: 'success', text: `百炼 CLI 已就绪${result.version ? `，${result.version}` : ''}。` });
      else {
        const refreshed = window.contentEngine ? await window.contentEngine.bailian.status().catch(() => undefined) : undefined;
        const detail = result.lastError || refreshed?.lastError || '检查失败，请重试。';
        setNotice({ type: 'error', text: `检查失败：${detail}` });
      }
    } catch (error) {
      const refreshed = window.contentEngine ? await window.contentEngine.bailian.status().catch(() => undefined) : undefined;
      const detail = refreshed?.lastError || (error instanceof Error ? error.message : '检查失败，请重试。');
      setNotice({ type: 'error', text: `检查失败：${detail}` });
    }
    finally { setBusy('idle'); }
  };
  return <div className="bailian-center"><section className="bailian-status"><div><span className={`connection-status ${status.status.toLowerCase()}`} /><b>{status.installed ? '内置 CLI' : 'CLI 未检测到'}</b>{status.version && <p>{status.version}</p>}</div><div className="bailian-status-meta"><span className={`chip ${status.status === 'READY' ? 'mint' : status.status === 'ERROR' ? 'red' : 'yellow'}`}>{status.status === 'READY' ? '已验证' : status.status === 'ERROR' ? '检查失败' : status.configured ? '待验证' : '未配置'}</span>{status.configured && <button className="text-button danger" onClick={() => void onRemove()}>移除 Key</button>}</div></section>
    <section className="scope-section"><h2>能力范围</h2><div className="scope-grid">{bailianScopes.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={`scope-card ${scope === item.id ? 'selected' : ''}`} onClick={() => setScope(item.id)} title={item.label}><Icon size={19}/><b>{item.label}</b></button>; })}</div></section>
    <section className="bailian-key-panel"><h2>访问凭证</h2><div className="bailian-key-form"><div className="key-field"><div className="key-field-head"><label htmlFor="bailian-api-key">百炼 API Key</label><span className={`chip ${hasTypedKey || status.configured ? 'mint' : 'yellow'}`}>{keyState}</span></div><input ref={keyInput} id="bailian-api-key" className={hasTypedKey ? 'has-value' : ''} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '输入新 Key 以替换' : '粘贴 API Key'} autoComplete="off" /></div>{notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}<div><button className="button" type="button" disabled={busy !== 'idle' || !canUseKey} onClick={test}><KeyRound size={16}/>{busy === 'testing' ? '检查中' : '保存并检查'}</button><button className="button primary" type="button" disabled={busy !== 'idle' || !canUseKey} onClick={save}>{busy === 'saving' ? '保存中' : '保存'}</button></div></div></section>
  </div>;
}

function LegacyExternalApiConnections({ connections, onNew, onEdit, onRemove }: { connections: ModelConnection[]; onNew: () => void; onEdit: (connection: ModelConnection) => void; onRemove: (connection: ModelConnection) => Promise<void> }) {
  return <section className="external-api-page"><div className="external-api-head"><div><h2>已保存的外部连接</h2><p>它们用于补充特定文本模型或 OpenAI 兼容接口。视觉、音频、视频任务优先由百炼 CLI 执行。</p></div><button className="button primary" onClick={onNew}><Plus size={16}/>新增 API 连接</button></div>{connections.length === 0 ? <div className="external-api-empty"><KeyRound size={24}/><h2>尚未添加外部 API</h2><p>先配置百炼 CLI；只有需要额外模型或私有兼容服务时，再添加外部 API。</p><button className="button" onClick={onNew}>新增外部连接</button></div> : <div className="external-connection-list">{connections.map((connection) => <article className="external-connection-row" key={connection.id}><div className="connection-provider"><span className={`connection-status ${connection.status.toLowerCase()}`} /><div><b>{connection.label}</b><small>{providerLabels[connection.provider]} · {connection.model}</small></div></div><div className="connection-scopes">{connection.purposes.map((purpose) => <span className="chip" key={purpose}>{modelPurposeNames[purpose]}</span>)}</div><div className="connection-actions"><button className="text-button" onClick={() => onEdit(connection)}><Pencil size={15}/>编辑</button><button className="icon-button danger-icon" aria-label={`移除 ${connection.label}`} onClick={() => void onRemove(connection)}><Trash2 size={17}/></button></div></article>)}</div>}</section>;
}

function LegacyExternalApiEditor({ connection, onBack, onSave, onTest }: { connection?: ModelConnection; onBack: () => void; onSave: (input: ModelConnectionInput) => Promise<ModelConnection>; onTest: (input: ModelConnectionInput) => Promise<ModelConnection> }) {
  const [draft, setDraft] = useState<ModelDraft>(() => connection ? { ...connection, apiKey: '' } : draftForProvider('SILICONFLOW'));
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const chooseProvider = (provider: ModelProvider) => { setDraft(draftForProvider(provider)); setNotice(null); };
  const makeInput = (): ModelConnectionInput => ({ ...draft, apiKey: draft.apiKey.trim() || undefined });
  const save = async () => {
    if (!draft.apiKey.trim() && !draft.id) { setNotice({ type: 'error', text: '请输入 API Key。' }); return; }
    setBusy('saving'); setNotice(null);
    try { await onSave(makeInput()); setDraft((current) => ({ ...current, apiKey: '' })); setNotice({ type: 'success', text: '外部 API 已加密保存。' }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存失败。' }); }
    finally { setBusy('idle'); }
  };
  const test = async () => {
    if (!draft.apiKey.trim() && !draft.id) { setNotice({ type: 'error', text: '请输入 API Key 后再检查。' }); return; }
    setBusy('testing'); setNotice(null);
    try { const result = await onTest(makeInput()); setDraft({ ...result, apiKey: '' }); setNotice(result.status === 'READY' ? { type: 'success', text: '连接可用。' } : { type: 'error', text: result.lastError || '连接检查未通过。' }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '连接检查失败。' }); }
    finally { setBusy('idle'); }
  };
  const togglePurpose = (purpose: keyof typeof modelPurposeNames) => setDraft((current) => ({ ...current, purposes: current.purposes.includes(purpose) ? current.purposes.filter((item) => item !== purpose) : [...current.purposes, purpose] }));
  return <div className="external-editor"><button className="back-button" onClick={onBack}><ArrowLeft size={17}/>返回外部 API 列表</button><PageHeader eyebrow="SETTINGS / 外部 API" title={connection ? `编辑 ${connection.label}` : '新增外部 API'} subtitle="外部 API 仅作为补充连接；百炼 CLI 是图像、音频、视频等综合能力的默认执行器。" /><section className="external-provider-picker"><h2>选择服务商</h2><div className="provider-grid">{externalModelProviders.map((item) => <button type="button" key={item.provider} className={`provider-card ${draft.provider === item.provider ? 'selected' : ''}`} onClick={() => chooseProvider(item.provider)}><b>{item.label}</b><small>{item.detail}</small></button>)}</div></section><section className="external-editor-form"><div className="model-form-heading"><div><h2>连接信息</h2><p>{draft.id ? '留空 API Key 即保留已保存的密钥。' : '填写服务商地址、模型名称和 API Key。'}</p></div><span className="chip blue"><ShieldCheck size={13}/>本机加密</span></div><label>连接名称<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><div className="model-form-grid"><label>API 地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label><label>模型名称<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label></div><label>API Key<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.id ? '已安全保存，输入可替换' : '粘贴 API Key'} autoComplete="off" /></label><fieldset><legend>允许用于哪些工作</legend><div className="purpose-grid">{(Object.keys(modelPurposeNames) as (keyof typeof modelPurposeNames)[]).map((purpose) => <label className="purpose-option" key={purpose}><input type="checkbox" checked={draft.purposes.includes(purpose)} onChange={() => togglePurpose(purpose)} />{modelPurposeNames[purpose]}</label>)}</div></fieldset>{notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}<footer><button className="button" type="button" disabled={busy !== 'idle'} onClick={test}><KeyRound size={16}/>{busy === 'testing' ? '检查中' : '保存并检查'}</button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={save}>{busy === 'saving' ? '保存中' : '加密保存'}</button></footer><small>检查仅请求服务商模型目录；不会生成内容，也不产生模型调用费用。</small></section></div>;
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

const domesticRssSources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[] = [
  { name: '36Kr', type: 'RSS', url: 'https://36kr.com/feed', category: '科技', includeKeywords: ['AI', '人工智能', '大模型', '模型', '机器人', '芯片'], enabled: true, refreshMinutes: 60, trust: '待核验', language: 'ZH' },
  { name: 'IT之家', type: 'RSS', url: 'https://www.ithome.com/rss/', category: '科技', includeKeywords: ['AI', '人工智能', '大模型', '模型', '机器人', '芯片'], enabled: true, refreshMinutes: 60, trust: '待核验', language: 'ZH' },
  { name: '少数派', type: 'RSS', url: 'https://sspai.com/feed', category: '创作', includeKeywords: ['AI', '工具', '效率', '创作'], enabled: true, refreshMinutes: 120, trust: '待核验', language: 'ZH' },
  { name: '中国新闻网', type: 'RSS', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', category: '时事', enabled: true, refreshMinutes: 120, trust: '可信', language: 'ZH' },
];
const internationalRssSources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[] = [
  { name: 'TechCrunch AI', type: 'RSS', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'AI', enabled: true, refreshMinutes: 60, trust: '待核验', language: 'EN' },
  { name: 'MIT Technology Review', type: 'RSS', url: 'https://www.technologyreview.com/feed/', category: '科技', includeKeywords: ['AI', 'artificial intelligence', 'model', 'robot', 'OpenAI', 'Google'], enabled: true, refreshMinutes: 120, trust: '待核验', language: 'EN' },
  { name: 'Hacker News 高热', type: 'RSS', url: 'https://hnrss.org/newest?points=100', category: '科技', enabled: true, refreshMinutes: 60, trust: '待核验', language: 'EN' },
  { name: 'Google AI', type: 'RSS', url: 'https://blog.google/technology/ai/rss/', category: 'AI', enabled: true, refreshMinutes: 120, trust: '可信', language: 'EN' },
  { name: 'OpenAI News', type: 'RSS', url: 'https://openai.com/news/rss.xml', category: 'AI', enabled: true, refreshMinutes: 120, trust: '可信', language: 'EN' },
];
const recommendedRssSources = [...domesticRssSources, ...internationalRssSources];

function SettingsHub({ sources, onAddSource, onAddSources, onRemoveSource }: { sources: IntelligenceSource[]; onAddSource: (source: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>) => void; onAddSources: (sources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[]) => void; onRemoveSource: (id: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('科技');
  const [includeKeywords, setIncludeKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [language, setLanguage] = useState<IntelligenceSource['language']>('ALL');
  const [error, setError] = useState('');
  const toKeywords = (value: string) => value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { new URL(url); } catch { setError('请输入有效的 RSS 地址。'); return; }
    onAddSource({ name: name.trim() || '未命名 RSS 源', type: 'RSS', url: url.trim(), category: category.trim() || '未分类', includeKeywords: toKeywords(includeKeywords), excludeKeywords: toKeywords(excludeKeywords), language, enabled: true, refreshMinutes: 60, trust: '待核验' });
    setName(''); setUrl(''); setIncludeKeywords(''); setExcludeKeywords(''); setError('');
  };
  return <><PageHeader eyebrow="DISCOVER / 情报源" title="资讯来源" /><section className="source-start"><div><b>推荐来源</b><p>国内和国际来源分开添加。</p></div><div className="source-start-actions"><button className="button" onClick={() => onAddSources(domesticRssSources)}>添加国内来源</button><button className="button" onClick={() => onAddSources(internationalRssSources)}>添加国际来源</button></div></section><div className="sources-layout"><section className="source-list"><div className="panel-head"><h2>已接入情报源</h2><span className="chip mint">{sources.length} 个</span></div>{sources.length === 0 ? <p className="source-empty">尚未添加来源。</p> : sources.map((source) => <article className="source-row" key={source.id}><div><b>{source.name}</b><small>{source.category} · {source.language === 'ZH' ? '中文' : source.language === 'EN' ? '英文' : '全部语言'} · 每 {source.refreshMinutes} 分钟</small>{source.includeKeywords?.length ? <small>包含：{source.includeKeywords.join('、')}</small> : <small>包含：全部</small>}{source.excludeKeywords?.length ? <small>排除：{source.excludeKeywords.join('、')}</small> : null}<p>{source.url}</p>{source.lastError && <em>{source.lastError}</em>}</div><div><span className={`chip ${source.lastError ? 'red' : 'mint'}`}>{source.lastSyncedAt ? `上次 ${source.lastSyncedAt}` : '尚未刷新'}</span><button className="text-button danger" onClick={() => onRemoveSource(source.id)}>移除</button></div></article>)}</section><form className="source-form" onSubmit={submit}><h2>添加 RSS</h2><label>来源名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>RSS 地址<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><label>归属题材<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="科技、财经、历史、人文、国学" /></label><label>包含词<input value={includeKeywords} onChange={(event) => setIncludeKeywords(event.target.value)} placeholder="AI、大模型、人工智能" /></label><label>排除词<input value={excludeKeywords} onChange={(event) => setExcludeKeywords(event.target.value)} placeholder="广告、招聘" /></label><label>语言<select value={language} onChange={(event) => setLanguage(event.target.value as IntelligenceSource['language'])}><option value="ALL">全部</option><option value="ZH">中文</option><option value="EN">英文</option></select></label>{error && <p className="form-error">{error}</p>}<button className="button primary wide" type="submit"><Plus size={16}/>添加并启用</button></form></div></>;
}

function WorkspaceSettings({ template, onTemplateChange }: { template: FeishuLibraryTemplate; onTemplateChange: (template: FeishuLibraryTemplate) => void }) {
  return <><PageHeader eyebrow="SETTINGS / 工作空间" title="项目设置" /><FeishuTemplateEditor template={template} onChange={onTemplateChange} /></>;
}

function LegacySettingsHub({ sources, template, onTemplateChange, onAddSource, onAddSources, onRemoveSource }: { sources: IntelligenceSource[]; template: FeishuLibraryTemplate; onTemplateChange: (template: FeishuLibraryTemplate) => void; onAddSource: (source: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>) => void; onAddSources: (sources: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>[]) => void; onRemoveSource: (id: string) => void }) {
  const [section, setSection] = useState<'sources' | 'feishu' | 'models'>('sources');
  const [models, setModels] = useState<ModelConnection[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('AI');
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try { new URL(url); } catch { setError('请输入有效的 RSS 地址。'); return; }
    onAddSource({ name: name.trim() || '未命名 RSS 源', type: 'RSS', url: url.trim(), category: category.trim() || '未分类', enabled: true, refreshMinutes: 60, trust: '待核验' });
    setName(''); setUrl(''); setError('');
  };
  const addRecommendedSources = () => onAddSources(recommendedRssSources);
  const loadModels = () => void window.contentEngine?.models.list().then(setModels).catch(() => undefined);
  useEffect(loadModels, []);
  return <><PageHeader eyebrow="SETTINGS / 工作流设置" title={section === 'sources' ? '资讯来源' : '飞书内容库'} /><div className="settings-tabs"><button className={section === 'sources' ? 'active' : ''} onClick={() => setSection('sources')}>情报源</button><button className={section === 'feishu' ? 'active' : ''} onClick={() => setSection('feishu')}>飞书内容库</button></div>{section === 'sources' ? <><section className="source-start"><div><b>推荐来源</b><p>RSS 自动更新；公众号、X、今日头条和公开网页使用左侧“剪藏链接”录入。</p></div><button className="button" onClick={addRecommendedSources}>添加推荐来源</button></section><div className="sources-layout"><section className="source-list"><div className="panel-head"><h2>已接入情报源</h2><span className="chip mint">{sources.length} 个</span></div>{sources.length === 0 ? <p className="source-empty">尚未添加来源。</p> : sources.map((source) => <article className="source-row" key={source.id}><div><b>{source.name}</b><small>{source.category} · 每 {source.refreshMinutes} 分钟</small><p>{source.url}</p>{source.lastError && <em>{source.lastError}</em>}</div><div><span className={`chip ${source.lastError ? 'red' : 'mint'}`}>{source.lastSyncedAt ? `上次 ${source.lastSyncedAt}` : '尚未刷新'}</span><button className="text-button danger" onClick={() => onRemoveSource(source.id)}>移除</button></div></article>)}</section><form className="source-form" onSubmit={submit}><h2>添加 RSS</h2><label>来源名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>RSS 地址<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label><label>归属题材<input value={category} onChange={(event) => setCategory(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary wide" type="submit"><Plus size={16}/>添加并启用</button></form></div></> : <FeishuTemplateEditor template={template} onChange={onTemplateChange} />}</>;
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

function WebSearchPanel({ onSave, onNavigate }: { onSave: (item: LocalState['intelligence'][number]) => void; onNavigate: (view: View) => void }) {
  const [configured, setConfigured] = useState(false); const [checking, setChecking] = useState(true); const [query, setQuery] = useState(''); const [category, setCategory] = useState('科技'); const [domains, setDomains] = useState<string[]>([]); const [results, setResults] = useState<LocalState['intelligence']>([]); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [added, setAdded] = useState<string[]>([]);
  useEffect(() => { const load = async () => { try { const result = await webSearchStatus(); setConfigured(Boolean(result?.configured)); } catch { setConfigured(false); } finally { setChecking(false); } }; void load(); }, []);
  const toggleDomain = (domain: string) => setDomains((current) => current.includes(domain) ? current.filter((item) => item !== domain) : [...current, domain]);
  const search = async () => { if (!configured || !query.trim()) return; setBusy(true); setNotice(''); setAdded([]); try { const items = await searchWeb({ query: query.trim(), category: category.trim() || '未分类', domains }); setResults(items ?? []); } catch (error) { setNotice(displayError(error, '搜索失败。')); } finally { setBusy(false); } };
  const saveCandidate = (item: LocalState['intelligence'][number]) => { onSave(item); setAdded((current) => [...current, item.id]); };
  return <><PageHeader eyebrow="DISCOVER / 网页搜索" title="搜索候选" /><section className="web-search">{!checking && !configured ? <div className="web-search-empty"><div><b>尚未配置检索 API</b></div><button className="button primary" onClick={() => onNavigate('models')}>前往模型与 API</button></div> : <div className="web-search-workspace"><form className="web-search-query" onSubmit={(event) => { event.preventDefault(); void search(); }}><div className="web-search-field"><label>检索词</label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：人工智能 大模型 最新政策" autoFocus /></div><div className="web-search-field compact"><label>题材</label><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="科技" /></div><fieldset className="web-search-sources"><legend>来源范围</legend><div><button type="button" className={domains.length === 0 ? 'chosen' : ''} onClick={() => setDomains([])}>全网</button>{[['toutiao.com','今日头条'],['mp.weixin.qq.com','公众号'],['x.com','X']].map(([domain,label]) => <button type="button" key={domain} className={domains.includes(domain) ? 'chosen' : ''} onClick={() => toggleDomain(domain)}>{label}</button>)}</div></fieldset><button className="button primary web-search-submit" type="submit" disabled={busy || !query.trim()}>{busy ? '检索中' : '开始检索'}</button></form><section className="web-search-results" aria-busy={busy}><div className="web-search-results-head"><h2>候选结果</h2><span>{busy ? '正在检索公开网页' : results.length ? `${results.length} 条` : '等待检索'}</span></div>{notice && <p className="form-error">{notice}</p>}{busy ? <div className="web-search-skeleton"><i/><i/><i/></div> : results.length === 0 ? <div className="web-search-results-empty">输入检索词后开始查找</div> : <div className="search-results">{results.map((item) => <article key={item.id}><div className="search-result-copy"><b>{item.title}</b><p>{item.summary}</p><small>{item.source} · {item.category}</small></div><div className="search-result-actions"><a href={item.url} target="_blank" rel="noreferrer">查看原文</a><button className="button" disabled={added.includes(item.id)} onClick={() => saveCandidate(item)}>{added.includes(item.id) ? '已加入' : '加入热点池'}</button></div></article>)}</div>}</section></div>}</section></>;
}

function Utility({ title, description }: { title: string; description: string }) { return <><PageHeader eyebrow="UTILITY / 辅助能力" title={title}/><section className="utility"><Lightbulb size={24}/><h2>该模块已预留</h2><p>{description}</p></section></>; }

function WebEntry() {
  const [session, setSession] = useState<WebSession | null>(() => window.contentEngine ? { accessToken: 'desktop', user: { id: 'desktop', email: '' }, workspace: { id: 'desktop', name: 'desktop' } } : webAuth.session());
  const [checking, setChecking] = useState(!window.contentEngine && Boolean(webAuth.session()));
  useEffect(() => {
    if (window.contentEngine || !webAuth.session()) return;
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

createRoot(document.getElementById('root')!).render(<WebEntry />);
