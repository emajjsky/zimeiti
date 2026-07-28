import { ArrowRight, FileInput, FileText, Lightbulb, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CreateProjectInput } from '../../data/webApi';
import {
  projectCenterAction,
  projectCenterFilters,
  projectsForCenterFilter,
  selectedProjectIdForList,
  type ProjectCenterFilterId,
} from '../../domain/creative-project-center.mjs';
import { platformName, projectOriginName, projectStageName, type ContentProject, type Platform } from '../../domain/content';

const creationSources: { id: CreateProjectInput['originType']; label: string; icon: typeof Lightbulb }[] = [
  { id: 'MANUAL', label: '手工想法', icon: Lightbulb },
  { id: 'DRAFT', label: '已有草稿', icon: FileText },
  { id: 'IMPORT', label: '导入内容', icon: FileInput },
];

const selectablePlatforms: Platform[] = ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'];

function updatedLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
}

function plannedPublishLabel(value?: string) {
  if (!value) return '未排期';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time));
}

function DetailField({ label, value, wide = false }: { label: string; value?: string; wide?: boolean }) {
  return <div className={wide ? 'creative-project-detail-field wide' : 'creative-project-detail-field'}>
    <dt>{label}</dt>
    <dd>{value?.trim() || '—'}</dd>
  </div>;
}

function ProjectDetail({ project, onOpenProject, onClose, className = '' }: {
  project: ContentProject;
  onOpenProject: (project: ContentProject) => void;
  onClose?: () => void;
  className?: string;
}) {
  return <section className={`creative-project-detail ${className}`.trim()} aria-label={`${project.title} 项目详情`}>
    <header>
      <div className="creative-project-detail-tags">
        <span className={`creative-origin-tag origin-${project.originType.toLowerCase()}`}>{projectOriginName[project.originType]}</span>
        <span className={`creative-stage-tag stage-${project.stage.toLowerCase()}`}>{projectStageName[project.stage]}</span>
      </div>
      {onClose && <button className="icon-button" type="button" aria-label="关闭项目详情" onClick={onClose}><X size={18}/></button>}
    </header>
    <div className="creative-project-detail-title">
      <h2>{project.title}</h2>
      <span>{project.planning.category || '未分类'}</span>
    </div>
    <dl className="creative-project-detail-grid">
      <DetailField label="创作角度" value={project.planning.angle} wide />
      <DetailField label="创作目标" value={project.planning.objective} wide />
      <DetailField label="目标受众" value={project.planning.targetAudience} />
      <DetailField label="计划发布时间" value={plannedPublishLabel(project.planning.plannedPublishAt)} />
      <DetailField label="核心表达" value={project.planning.coreMessage} wide />
      <DetailField label="来源与核验要求" value={project.planning.sourceRequirements} wide />
    </dl>
    <div className="creative-project-detail-platforms">
      <span>目标平台</span>
      <div>{project.planning.targetPlatforms.map((platform) => <em className={`platform-${platform.toLowerCase()}`} key={platform}>{platformName[platform]}</em>)}</div>
    </div>
    <footer>
      <time>更新于 {updatedLabel(project.updatedAt)}</time>
      <button className="button primary" type="button" onClick={() => onOpenProject(project)}>{projectCenterAction(project.stage)}<ArrowRight size={16}/></button>
    </footer>
  </section>;
}

export function CreativeProjectCenter({ projects, onOpenProject, onCreateProject, creationRequested = false, onCreationHandled }: {
  projects: ContentProject[];
  onOpenProject: (project: ContentProject) => void;
  onCreateProject: (input: CreateProjectInput) => Promise<ContentProject>;
  creationRequested?: boolean;
  onCreationHandled?: () => void;
}) {
  const [filter, setFilter] = useState<ProjectCenterFilterId>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
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

  const visibleProjects = useMemo(() => projectsForCenterFilter(projects, filter), [filter, projects]);
  const selectedProject = visibleProjects.find((project) => project.id === selectedProjectId) ?? visibleProjects[0];

  useEffect(() => {
    setSelectedProjectId((current) => selectedProjectIdForList(visibleProjects, current));
    setMobileDetailOpen(false);
  }, [visibleProjects]);

  const closeCreation = () => {
    setCreating(false);
    setError('');
    onCreationHandled?.();
  };

  const togglePlatform = (platform: Platform) => {
    setTargetPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };

  const selectProject = (project: ContentProject, openMobileDetail = false) => {
    setSelectedProjectId(project.id);
    if (openMobileDetail) setMobileDetailOpen(true);
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
      {projectCenterFilters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
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

    {visibleProjects.length > 0 && selectedProject ? <>
      <div className="creative-project-list-layout">
        <div className="creative-project-table-shell">
          <table className="creative-project-table">
            <thead><tr><th>项目</th><th>题材</th><th>目标平台</th><th>来源</th><th>阶段</th><th>更新时间</th></tr></thead>
            <tbody>{visibleProjects.map((project) => <tr
              key={project.id}
              className="creative-project-row"
              tabIndex={0}
              aria-selected={selectedProject.id === project.id}
              onClick={() => selectProject(project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectProject(project);
                }
              }}
            >
              <td><strong>{project.title}</strong></td>
              <td><span className="creative-project-category">{project.planning.category || '未分类'}</span></td>
              <td><div className="creative-project-row-platforms">{project.planning.targetPlatforms.map((platform) => <span className={`platform-${platform.toLowerCase()}`} key={platform}>{platformName[platform]}</span>)}</div></td>
              <td><span className={`creative-origin-tag origin-${project.originType.toLowerCase()}`}>{projectOriginName[project.originType]}</span></td>
              <td><span className={`creative-stage-tag stage-${project.stage.toLowerCase()}`}>{projectStageName[project.stage]}</span></td>
              <td><time>{updatedLabel(project.updatedAt)}</time></td>
            </tr>)}</tbody>
          </table>
        </div>
        <ProjectDetail project={selectedProject} onOpenProject={onOpenProject} />
      </div>

      <div className="creative-project-mobile-list" aria-label="内容项目列表">
        {visibleProjects.map((project) => <button
          type="button"
          className="creative-project-mobile-row"
          aria-pressed={selectedProject.id === project.id}
          key={project.id}
          onClick={() => selectProject(project, true)}
        >
          <span className="creative-project-mobile-row-head"><strong>{project.title}</strong><ArrowRight size={16}/></span>
          <span className="creative-project-mobile-row-meta">
            <em>{project.planning.category || '未分类'}</em>
            <span className={`creative-origin-tag origin-${project.originType.toLowerCase()}`}>{projectOriginName[project.originType]}</span>
            <span className={`creative-stage-tag stage-${project.stage.toLowerCase()}`}>{projectStageName[project.stage]}</span>
            <time>{updatedLabel(project.updatedAt)}</time>
          </span>
        </button>)}
      </div>

      {mobileDetailOpen && <div className="creative-project-mobile-detail-layer">
        <button className="creative-project-mobile-backdrop" type="button" aria-label="关闭项目详情" onClick={() => setMobileDetailOpen(false)} />
        <aside className="creative-project-mobile-drawer" role="dialog" aria-modal="true">
          <ProjectDetail project={selectedProject} onOpenProject={onOpenProject} onClose={() => setMobileDetailOpen(false)} />
        </aside>
      </div>}
    </> : <div className="creative-project-empty">
      <FileText size={28}/><h2>{projects.length ? '这个阶段还没有项目' : '还没有内容项目'}</h2>
      {!projects.length && <button className="button primary" type="button" onClick={() => setCreating(true)}>新建第一篇内容</button>}
    </div>}
  </section>;
}
