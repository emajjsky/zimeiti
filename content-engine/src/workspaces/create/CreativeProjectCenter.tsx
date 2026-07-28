import { ArrowRight, FileInput, FileText, Lightbulb, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CreateProjectInput } from '../../data/webApi';
import { platformName, projectOriginName, projectStageName, type ContentProject, type Platform, type ProjectStage } from '../../domain/content';

type Filter = 'ALL' | 'PLANNING' | 'RESEARCH' | 'MASTER' | 'PLATFORM' | 'REVIEW' | 'COMPLETED';

const filters: { id: Filter; label: string; stages?: ProjectStage[] }[] = [
  { id: 'ALL', label: '全部' },
  { id: 'PLANNING', label: '待规划', stages: ['PLANNING'] },
  { id: 'RESEARCH', label: '研究中', stages: ['RESEARCH'] },
  { id: 'MASTER', label: '正文中', stages: ['MASTER_WRITING'] },
  { id: 'PLATFORM', label: '制作中', stages: ['PLATFORM_ADAPTATION', 'VISUAL', 'LAYOUT'] },
  { id: 'REVIEW', label: '待审核', stages: ['REVIEW'] },
  { id: 'COMPLETED', label: '已完成', stages: ['COMPLETED'] },
];

const creationSources: { id: CreateProjectInput['originType']; label: string; icon: typeof Lightbulb }[] = [
  { id: 'MANUAL', label: '手工想法', icon: Lightbulb },
  { id: 'DRAFT', label: '已有草稿', icon: FileText },
  { id: 'IMPORT', label: '导入内容', icon: FileInput },
];

const selectablePlatforms: Platform[] = ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'];

function nextAction(project: ContentProject) {
  return {
    PLANNING: '完成规划',
    RESEARCH: '继续研究',
    MASTER_WRITING: '继续正文',
    PLATFORM_ADAPTATION: '制作平台版本',
    VISUAL: '处理配图',
    LAYOUT: '继续排版',
    REVIEW: '完成审核',
    COMPLETED: '查看项目',
  }[project.stage];
}

function updatedLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
}

export function CreativeProjectCenter({ projects, onOpenProject, onCreateProject, creationRequested = false, onCreationHandled }: {
  projects: ContentProject[];
  onOpenProject: (project: ContentProject) => void;
  onCreateProject: (input: CreateProjectInput) => Promise<ContentProject>;
  creationRequested?: boolean;
  onCreationHandled?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [creating, setCreating] = useState(creationRequested);
  const [originType, setOriginType] = useState<CreateProjectInput['originType']>('MANUAL');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [draftText, setDraftText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [targetPlatforms, setTargetPlatforms] = useState<Platform[]>(['WECHAT']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (creationRequested) setCreating(true);
  }, [creationRequested]);

  const visibleProjects = useMemo(() => {
    const stages = filters.find((item) => item.id === filter)?.stages;
    return stages ? projects.filter((project) => stages.includes(project.stage)) : projects;
  }, [filter, projects]);

  const closeCreation = () => {
    setCreating(false);
    setError('');
    onCreationHandled?.();
  };

  const togglePlatform = (platform: Platform) => {
    setTargetPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (targetPlatforms.length === 0) { setError('请至少选择一个目标平台。'); return; }
    if (originType === 'IMPORT' && !importUrl.trim()) { setError('请输入要导入的链接。'); return; }
    setBusy(true); setError('');
    try {
      const project = await onCreateProject({ originType, title: title.trim(), category: category.trim(), draftText: draftText.trim() || undefined, importUrl: importUrl.trim() || undefined, targetPlatforms });
      closeCreation();
      onOpenProject(project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败。');
    } finally {
      setBusy(false);
    }
  };

  return <section className="creative-project-center">
    <header className="creative-project-center-head">
      <div><h1>创作</h1><p>{projects.length} 个内容项目</p></div>
      <button className="button primary" type="button" onClick={() => setCreating(true)}><Plus size={17}/>新建创作</button>
    </header>

    <nav className="creative-project-filters" aria-label="内容项目筛选">
      {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </nav>

    {creating && <form className="creative-project-create" onSubmit={submit}>
      <header><h2>新建创作</h2><button className="icon-button" type="button" aria-label="关闭" onClick={closeCreation}><X size={18}/></button></header>
      <div className="creative-source-options">
        {creationSources.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={originType === id ? 'active' : ''} onClick={() => { setOriginType(id); setError(''); }}><Icon size={18}/>{label}</button>)}
      </div>
      <div className="creative-create-fields">
        <label><span>项目标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可以先写一个工作标题" autoFocus /></label>
        <label><span>题材</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如 AI、财经、历史" /></label>
        {originType === 'DRAFT' && <label className="wide"><span>已有草稿</span><textarea rows={7} value={draftText} onChange={(event) => setDraftText(event.target.value)} /></label>}
        {originType === 'IMPORT' && <label className="wide"><span>内容链接</span><input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://" /></label>}
        <fieldset className="wide"><legend>目标平台</legend><div>{selectablePlatforms.map((platform) => <label key={platform}><input type="checkbox" checked={targetPlatforms.includes(platform)} onChange={() => togglePlatform(platform)}/><span>{platformName[platform]}</span></label>)}</div></fieldset>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button className="button" type="button" onClick={closeCreation}>取消</button><button className="button primary" disabled={busy} type="submit">{busy ? '创建中' : '创建项目'}</button></footer>
    </form>}

    {visibleProjects.length > 0 ? <div className="creative-project-grid">
      {visibleProjects.map((project) => <article className="creative-project-card" key={project.id}>
        <div className={`creative-project-accent origin-${project.originType.toLowerCase()}`} />
        <header><span>{projectOriginName[project.originType]}</span><em>{projectStageName[project.stage]}</em></header>
        <button type="button" className="creative-project-card-main" onClick={() => onOpenProject(project)}>
          <h2>{project.title}</h2>
          {project.planning.coreMessage && <p>{project.planning.coreMessage}</p>}
        </button>
        <div className="creative-project-platforms">{project.planning.targetPlatforms.map((platform) => <span key={platform}>{platformName[platform]}</span>)}</div>
        <footer><time>{updatedLabel(project.updatedAt)}</time><button type="button" onClick={() => onOpenProject(project)}>{nextAction(project)}<ArrowRight size={16}/></button></footer>
      </article>)}
    </div> : <div className="creative-project-empty">
      <FileText size={28}/><h2>{projects.length ? '这个阶段还没有项目' : '还没有内容项目'}</h2>
      {!projects.length && <button className="button primary" type="button" onClick={() => setCreating(true)}>新建第一篇内容</button>}
    </div>}
  </section>;
}
