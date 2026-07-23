import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, createScope, stagger } from 'animejs';
import { ArrowLeft, AudioLines, Bell, BrainCircuit, CalendarDays, ChartColumn, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, ClipboardList, Compass, FolderOpen, Image, KeyRound, Lightbulb, PenLine, Pencil, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Trash2, Video, Zap } from 'lucide-react';
import { intelligenceKey, loadState, persistState, seedState, type FeishuLibraryTemplate, type LocalState, type WorkspaceProfile } from './data/localRepository';
import { platformName, projectStatusName, type ContentProject, type ContentVersion, type IntelligenceSource, type Platform, type TopicCandidate } from './domain/content';
import type { BailianCapabilityScope, BailianCliStatus, ModelConnection, ModelConnectionInput, ModelProvider } from './domain/integrations';
import './styles.css';

type View = 'today' | 'discover' | 'clip' | 'plan' | 'topicEditor' | 'create' | 'publish' | 'review' | 'assets' | 'automation' | 'models' | 'settings';

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
  { view: 'clip', label: '剪藏链接', icon: Compass },
  { view: 'automation', label: '自动化', icon: Zap },
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
      window.alert('请先在“设置”中添加并启用 RSS 情报源。');
      setView('settings');
      return;
    }
    setRefreshFeedback({ status: 'running', message: '正在读取已启用的情报源…' });
    try {
      const result = await window.contentEngine?.intelligence.refreshRss(state.sources);
      if (!result) throw new Error('当前不在桌面端环境。');
      const existingKeys = new Set(state.intelligence.map(intelligenceKey));
      const received = result.items.filter((item) => !existingKeys.has(intelligenceKey(item)));
      const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      updateState({ ...state, intelligence: [...received, ...state.intelligence], sources: state.sources.map((source) => {
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
    updateState({ ...state, sources: [...state.sources, { ...source, id: `source-${Date.now()}` }] });
  };
  const removeSource = (sourceId: string) => updateState({ ...state, sources: state.sources.filter((source) => source.id !== sourceId) });
  const saveFeishuTemplate = (feishuTemplate: FeishuLibraryTemplate) => updateState({ ...state, feishuTemplate });
  const saveClippedLink = (item: Omit<LocalState['intelligence'][number], 'id'>) => {
    const id = `clip-${Date.now()}`;
    updateState({ ...state, intelligence: [{ ...item, id }, ...state.intelligence] });
    setSelectedIntelId(id); setView('discover');
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
      {view === 'discover' && selectedIntel && <Discover item={selectedIntel} intelligence={state.intelligence} onSelect={setSelectedIntelId} onCreateTopic={createTopicFromIntel} onRefresh={refreshRss} refreshFeedback={refreshFeedback} />}
      {view === 'clip' && <LinkClipEditor onSave={saveClippedLink} onCancel={() => setView('discover')} />}
      {view === 'plan' && selectedTopic && <Plan topics={state.topics} selected={selectedTopic} onSelect={setSelectedTopicId} onCreateProject={createProjectFromTopic} onEdit={openTopicEditor} onDelete={deleteTopic} />}
      {view === 'topicEditor' && <TopicEditor key={editingTopicId ?? 'new'} topic={state.topics.find((topic) => topic.id === editingTopicId)} defaultCategory={state.workspace.primaryTopics[0] ?? '未分类'} onSave={saveTopic} onCancel={() => { setEditingTopicId(null); setView('plan'); }} />}
      {view === 'create' && <Create project={featuredProject} activePlatform={activePlatform} onPlatform={setActivePlatform} activeVersion={activeVersion} progress={platformProgress} onSaveVersion={saveContentVersion} />}
      {view === 'publish' && <Publish project={featuredProject} onNavigate={setView} />}
      {view === 'review' && <Review onNavigate={setView} />}
      {view === 'assets' && <Utility title="素材库" description="本地与云端素材将以目录、紧凑列表和素材检查器呈现；不会打断内容项目主编辑流程。" />}
      {view === 'automation' && <Utility title="自动化规则" description="首期使用预设任务：每日热点、飞书镜像、数据回流与本机渲染；不做自由流程画布。" />}
      {view === 'models' && <ModelSettingsScreen />}
      {view === 'settings' && <SettingsHub sources={state.sources} template={state.feishuTemplate} onTemplateChange={saveFeishuTemplate} onAddSource={addSource} onRemoveSource={removeSource} />}
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

function Discover({ item, intelligence, onSelect, onCreateTopic, onRefresh, refreshFeedback }: { item: LocalState['intelligence'][number]; intelligence: LocalState['intelligence']; onSelect: (id: string) => void; onCreateTopic: () => void; onRefresh: () => void; refreshFeedback: { status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string } }) { return <>
  <PageHeader eyebrow="DISCOVER / 热点情报" title="今日热点" />
  <div className="filter-row"><div>{['全部','AI','财经','历史','人文','国学'].map((label,index) => <button key={label} className={`filter ${index === 0 ? 'active' : ''}`}>{label}</button>)}<span className="filter-note">近 7 天</span></div><button className="button primary" onClick={onRefresh} disabled={refreshFeedback.status === 'running'}><RefreshCw className={refreshFeedback.status === 'running' ? 'spin' : ''} size={15}/>{refreshFeedback.status === 'running' ? '正在刷新' : '刷新热点'}</button></div>
  {refreshFeedback.status !== 'idle' && <div className={`refresh-feedback ${refreshFeedback.status}`} role="status"><span>{refreshFeedback.status === 'running' ? '…' : refreshFeedback.status === 'success' ? '✓' : refreshFeedback.status === 'error' ? '!' : 'i'}</span>{refreshFeedback.message}</div>}
  <div className="discover-layout"><section className="signal-list">{intelligence.map((signal) => <button key={signal.id} className={`signal ${signal.id === item.id ? 'selected' : ''}`} onClick={() => onSelect(signal.id)}><span className="signal-icon">{signal.category === 'AI' ? '⌘' : signal.category === '财经' ? '↗' : '▤'}</span><span><b>{signal.title}</b><p>{signal.summary}</p><small>{signal.publishedAt} · {signal.category} · {signal.source}</small></span><span><em className={`chip ${signal.trust === '可信' ? 'mint' : 'yellow'}`}>{signal.trust}</em><em className="chip">{signal.heat} 热度</em></span></button>)}</section>
  <aside className="detail-drawer"><span className="chip blue">已选中热点</span><h2>{item.title}</h2><p>{item.summary}</p><div className="idea"><b>建议角度</b><br/>普通人如何用 AI 视频工具做出能看的知识短片？</div><p className="source-link">来源：{item.source} ↗</p><footer><button className="text-button">忽略</button><button className="button primary" onClick={onCreateTopic}>创建选题</button></footer></aside></div>
  </>; }

function LinkClipEditor({ onSave, onCancel }: { onSave: (item: Omit<LocalState['intelligence'][number], 'id'>) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [source, setSource] = useState('公众号文章'); const [summary, setSummary] = useState(''); const [category, setCategory] = useState('未分类'); const [note, setNote] = useState(''); const [error, setError] = useState('');
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

function LegacyModelSettingsScreen() {
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

function ModelSettingsScreen() {
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

function BailianCliCenter({ status, onSave, onTest, onRemove }: { status: BailianCliStatus; onSave: (input: { apiKey?: string; scope: BailianCapabilityScope }) => Promise<BailianCliStatus>; onTest: () => Promise<BailianCliStatus>; onRemove: () => Promise<void> }) {
  const [scope, setScope] = useState<BailianCapabilityScope>(status.scope);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => setScope(status.scope), [status.scope]);
  const save = async () => {
    if (!apiKey.trim() && !status.configured) { setNotice({ type: 'error', text: '请输入百炼 API Key。' }); return; }
    setBusy('saving'); setNotice(null);
    try { await onSave({ apiKey: apiKey.trim() || undefined, scope }); setApiKey(''); setNotice({ type: 'success', text: '百炼配置已加密保存。' }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存百炼配置失败。' }); }
    finally { setBusy('idle'); }
  };
  const test = async () => {
    setBusy('testing'); setNotice(null);
    try {
      if (apiKey.trim()) await onSave({ apiKey: apiKey.trim(), scope });
      const result = await onTest(); setApiKey('');
      setNotice(result.status === 'READY' ? { type: 'success', text: `百炼 CLI 已就绪${result.version ? `，${result.version}` : ''}。` } : { type: 'error', text: result.lastError || '检查没有返回具体原因。请关闭后重新启动桌面端，再执行检查。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? `检查失败：${error.message}` : '检查失败，未获得具体原因。' }); }
    finally { setBusy('idle'); }
  };
  return <div className="bailian-center"><section className="bailian-status"><div><span className={`connection-status ${status.status.toLowerCase()}`} /><b>{status.installed ? '内置 CLI' : 'CLI 未检测到'}</b>{status.version && <p>{status.version}</p>}</div><div className="bailian-status-meta"><span className={`chip ${status.status === 'READY' ? 'mint' : status.status === 'ERROR' ? 'red' : 'yellow'}`}>{status.status === 'READY' ? '已验证' : status.configured ? '待验证' : '未配置'}</span>{status.configured && <button className="text-button danger" onClick={() => void onRemove()}>移除 Key</button>}</div></section>
    <section className="scope-section"><h2>能力范围</h2><div className="scope-grid">{bailianScopes.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={`scope-card ${scope === item.id ? 'selected' : ''}`} onClick={() => setScope(item.id)} title={item.label}><Icon size={19}/><b>{item.label}</b></button>; })}</div></section>
    <section className="bailian-key-panel"><div className="bailian-key-head"><h2>访问凭证</h2>{status.configured && <span className="chip mint">已保存</span>}</div><div className="bailian-key-form"><label>百炼 API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.configured ? '输入新 Key 以替换' : '粘贴 API Key'} autoComplete="off" /></label>{notice && <p className={`model-notice ${notice.type}`} aria-live="polite">{notice.type === 'success' ? <CircleCheck size={17}/> : <CircleAlert size={17}/>} {notice.text}</p>}<div><button className="button" type="button" disabled={busy !== 'idle'} onClick={test}><KeyRound size={16}/>{busy === 'testing' ? '检查中' : '保存并检查'}</button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={save}>{busy === 'saving' ? '保存中' : '保存'}</button></div></div></section>
  </div>;
}

function ExternalApiConnections({ connections, onNew, onEdit, onRemove }: { connections: ModelConnection[]; onNew: () => void; onEdit: (connection: ModelConnection) => void; onRemove: (connection: ModelConnection) => Promise<void> }) {
  return <section className="external-api-page"><div className="external-api-head"><div><h2>已保存的外部连接</h2><p>它们用于补充特定文本模型或 OpenAI 兼容接口。视觉、音频、视频任务优先由百炼 CLI 执行。</p></div><button className="button primary" onClick={onNew}><Plus size={16}/>新增 API 连接</button></div>{connections.length === 0 ? <div className="external-api-empty"><KeyRound size={24}/><h2>尚未添加外部 API</h2><p>先配置百炼 CLI；只有需要额外模型或私有兼容服务时，再添加外部 API。</p><button className="button" onClick={onNew}>新增外部连接</button></div> : <div className="external-connection-list">{connections.map((connection) => <article className="external-connection-row" key={connection.id}><div className="connection-provider"><span className={`connection-status ${connection.status.toLowerCase()}`} /><div><b>{connection.label}</b><small>{providerLabels[connection.provider]} · {connection.model}</small></div></div><div className="connection-scopes">{connection.purposes.map((purpose) => <span className="chip" key={purpose}>{modelPurposeNames[purpose]}</span>)}</div><div className="connection-actions"><button className="text-button" onClick={() => onEdit(connection)}><Pencil size={15}/>编辑</button><button className="icon-button danger-icon" aria-label={`移除 ${connection.label}`} onClick={() => void onRemove(connection)}><Trash2 size={17}/></button></div></article>)}</div>}</section>;
}

function ExternalApiEditor({ connection, onBack, onSave, onTest }: { connection?: ModelConnection; onBack: () => void; onSave: (input: ModelConnectionInput) => Promise<ModelConnection>; onTest: (input: ModelConnectionInput) => Promise<ModelConnection> }) {
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

function SettingsHub({ sources, template, onTemplateChange, onAddSource, onRemoveSource }: { sources: IntelligenceSource[]; template: FeishuLibraryTemplate; onTemplateChange: (template: FeishuLibraryTemplate) => void; onAddSource: (source: Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>) => void; onRemoveSource: (id: string) => void }) {
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
  const addExample = () => onAddSource({ name: 'TechCrunch AI（示例）', type: 'RSS', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'AI', enabled: true, refreshMinutes: 60, trust: '待核验' });
  const loadModels = () => void window.contentEngine?.models.list().then(setModels).catch(() => undefined);
  useEffect(loadModels, []);
  return <><PageHeader eyebrow="SETTINGS / 工作流设置" title={section === 'sources' ? '先让热点流进来' : '再定义飞书内容库'} subtitle={section === 'sources' ? '第一步只需添加一个资讯来源；不知道 RSS 地址时可以先使用示例源。' : '这里仅保存内容库模板，不会连接或修改任何飞书数据。'} /><div className="settings-tabs"><button className={section === 'sources' ? 'active' : ''} onClick={() => setSection('sources')}>1 情报源</button><button className={section === 'feishu' ? 'active' : ''} onClick={() => setSection('feishu')}>2 飞书内容库</button></div>{section === 'sources' ? <><section className="source-start"><div><b>还不知道填什么？</b><p>先添加示例源，到“发现”页点击刷新热点。确认流程可用后，再替换成你信任的行业来源。</p></div><button className="button" onClick={addExample}>添加示例源</button></section><div className="sources-layout"><section className="source-list"><div className="panel-head"><h2>已接入情报源</h2><span className="chip mint">{sources.length} 个</span></div>{sources.length === 0 ? <p className="source-empty">尚未添加来源。可以使用上方示例，或填写一个公开 RSS 地址。</p> : sources.map((source) => <article className="source-row" key={source.id}><div><b>{source.name}</b><small>{source.category} · 每 {source.refreshMinutes} 分钟</small><p>{source.url}</p>{source.lastError && <em>{source.lastError}</em>}</div><div><span className={`chip ${source.lastError ? 'red' : 'mint'}`}>{source.lastSyncedAt ? `上次 ${source.lastSyncedAt}` : '尚未刷新'}</span><button className="text-button danger" onClick={() => onRemoveSource(source.id)}>移除</button></div></article>)}</section><form className="source-form" onSubmit={submit}><h2>添加自己的 RSS 源</h2><label>来源名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：36氪 AI" /></label><label>RSS 地址<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="在资讯网站找到的订阅地址" /></label><label>归属题材<input value={category} onChange={(event) => setCategory(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary wide" type="submit"><Plus size={16}/>添加并启用</button><small>支持公开 HTTP(S) RSS。后续可接 Tavily 搜索，不要求你永远手填 RSS。</small></form></div></> : <FeishuTemplateEditor template={template} onChange={onTemplateChange} />}</>;
}

function FeishuTemplateEditor({ template, onChange }: { template: FeishuLibraryTemplate; onChange: (template: FeishuLibraryTemplate) => void }) {
  const tables = ['热点库', '选题池', ...(template.includeSchedule ? ['内容排期'] : []), ...(template.includeReview ? ['复盘数据'] : []), '同步日志'];
  const update = (patch: Partial<FeishuLibraryTemplate>) => onChange({ ...template, ...patch, status: 'READY_TO_CREATE' });
  return <section className="feishu-template"><div className="template-head"><div><div className="eyebrow">FEISHU / 内容库模板</div><h2>先定义内容库，再授权创建</h2><p>不会写入你的现有 Base；真正创建前会要求飞书授权和最终确认。</p></div><span className="chip yellow">{template.status === 'DRAFT' ? '待配置' : template.status === 'CREATED' ? '已创建' : '待授权创建'}</span></div><div className="template-grid"><label>内容库名称<input value={template.name} onChange={(event) => update({ name: event.target.value })} /></label><fieldset><legend>题材组织方式</legend><button className={template.topicStorage === 'ONE_TABLE' ? 'chosen' : ''} onClick={() => update({ topicStorage: 'ONE_TABLE' })} type="button">一张总表</button><button className={template.topicStorage === 'BY_CATEGORY' ? 'chosen' : ''} onClick={() => update({ topicStorage: 'BY_CATEGORY' })} type="button">按题材分表</button></fieldset><label className="toggle-line"><input type="checkbox" checked={template.includeSchedule} onChange={(event) => update({ includeSchedule: event.target.checked })} />创建内容排期表</label><label className="toggle-line"><input type="checkbox" checked={template.includeReview} onChange={(event) => update({ includeReview: event.target.checked })} />创建复盘数据表</label></div><div className="template-preview"><b>生成预览</b><div>{tables.map((table) => <span key={table}>{table}</span>)}</div><small>热点库和选题池会包含受保护的 <code>content_engine_id</code> 字段，用于稳定同步。</small></div><button className="button primary" type="button" disabled>下一步：授权并创建（云端 OAuth 开发中）</button></section>;
}

function Utility({ title, description }: { title: string; description: string }) { return <><PageHeader eyebrow="UTILITY / 辅助能力" title={title}/><section className="utility"><Lightbulb size={24}/><h2>该模块已预留</h2><p>{description}</p></section></>; }

createRoot(document.getElementById('root')!).render(<App />);
