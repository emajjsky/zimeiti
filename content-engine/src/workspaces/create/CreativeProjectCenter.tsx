import { ArrowRight, FileText, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CreateProjectInput } from '../../data/webApi';
import {
  projectCenterAction,
  projectCenterFilters,
  projectsForCenterFilter,
  selectedProjectIdForList,
  type ProjectCenterFilterId,
} from '../../domain/creative-project-center.mjs';
import { platformName, projectOriginName, projectStageName, type ContentProject } from '../../domain/content';
import { ContentIngestionPanel } from './ContentIngestionPanel';

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

function ProjectDetail({ project, onOpenProject, onDelete, onClose, className = '' }: {
  project: ContentProject;
  onOpenProject: (project: ContentProject) => void;
  onDelete?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  return <section className={`creative-project-detail ${className}`.trim()} aria-label={`${project.title} 项目详情`}>
    <header>
      <div className="creative-project-detail-tags">
        <span className={`creative-origin-tag origin-${project.originType.toLowerCase()}`}>{projectOriginName[project.originType]}</span>
        <span className={`creative-stage-tag stage-${project.stage.toLowerCase()}`}>{projectStageName[project.stage]}</span>
      </div>
      <div className="creative-project-detail-actions">
        {onDelete && <button className="text-button danger" type="button" onClick={onDelete}><Trash2 size={15}/>删除项目</button>}
        {onClose && <button className="icon-button" type="button" aria-label="关闭项目详情" onClick={onClose}><X size={18}/></button>}
      </div>
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

export function CreativeProjectCenter({ projects, onOpenProject, onCreateProject, onDeleteProject, onProjectCreated, creationRequested = false, onCreationHandled }: {
  projects: ContentProject[];
  onOpenProject: (project: ContentProject) => void;
  onCreateProject: (input: CreateProjectInput) => Promise<ContentProject>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onProjectCreated: (project: ContentProject) => void;
  creationRequested?: boolean;
  onCreationHandled?: () => void;
}) {
  const [filter, setFilter] = useState<ProjectCenterFilterId>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [creating, setCreating] = useState(creationRequested);
  const [deletingId, setDeletingId] = useState('');
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

  const selectProject = (project: ContentProject, openMobileDetail = false) => {
    setSelectedProjectId(project.id);
    if (openMobileDetail) setMobileDetailOpen(true);
  };

  const deleteProject = async (project: ContentProject) => {
    if (!window.confirm(`删除“${project.title}”？项目关联的草稿、素材、账号和已发布文章不会被删除。`)) return;
    setDeletingId(project.id);
    setError('');
    try {
      await onDeleteProject(project.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除项目失败。');
    } finally {
      setDeletingId('');
    }
  };

  if (creating) {
    return <section className="creative-project-center creation-mode">
      <ContentIngestionPanel
        onClose={closeCreation}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onProjectCreated={(project) => { onProjectCreated(project); onOpenProject(project); }}
      />
    </section>;
  }

  return <section className="creative-project-center">
    <header className="creative-project-center-head">
      <div><h1>创作</h1><p>{projects.length} 个内容项目</p></div>
      <button className="button primary" type="button" onClick={() => setCreating(true)}><Plus size={17}/>新建创作</button>
    </header>

    {error && <p className="inline-notice error" role="alert">{error}</p>}

    <nav className="creative-project-filters" aria-label="内容项目筛选">
      {projectCenterFilters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </nav>

    {visibleProjects.length > 0 && selectedProject ? <>
      <div className="creative-project-list-layout">
        <div className="creative-project-table-shell">
          <table className="creative-project-table">
            <thead><tr><th>项目</th><th>题材</th><th>目标平台</th><th>来源</th><th>阶段</th><th>更新时间</th><th>操作</th></tr></thead>
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
              <td><button className="text-button danger" type="button" disabled={deletingId === project.id} aria-label={`删除项目 ${project.title}`} onClick={(event) => { event.stopPropagation(); void deleteProject(project); }}><Trash2 size={15}/>{deletingId === project.id ? '删除中' : '删除'}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <ProjectDetail project={selectedProject} onOpenProject={onOpenProject} onDelete={() => void deleteProject(selectedProject)} />
      </div>

      <div className="creative-project-mobile-list" aria-label="内容项目列表">
        {visibleProjects.map((project) => <div
          className="creative-project-mobile-row"
          role="button"
          tabIndex={0}
          aria-pressed={selectedProject.id === project.id}
          key={project.id}
          onClick={() => selectProject(project, true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectProject(project, true);
            }
          }}
        >
          <span className="creative-project-mobile-row-head"><strong>{project.title}</strong><span><button className="text-button danger" type="button" aria-label={`删除项目 ${project.title}`} disabled={deletingId === project.id} onClick={(event) => { event.stopPropagation(); void deleteProject(project); }}><Trash2 size={14}/></button><ArrowRight size={16}/></span></span>
          <span className="creative-project-mobile-row-meta">
            <em>{project.planning.category || '未分类'}</em>
            <span className={`creative-origin-tag origin-${project.originType.toLowerCase()}`}>{projectOriginName[project.originType]}</span>
            <span className={`creative-stage-tag stage-${project.stage.toLowerCase()}`}>{projectStageName[project.stage]}</span>
            <time>{updatedLabel(project.updatedAt)}</time>
          </span>
        </div>)}
      </div>

      {mobileDetailOpen && <div className="creative-project-mobile-detail-layer">
        <button className="creative-project-mobile-backdrop" type="button" aria-label="关闭项目详情" onClick={() => setMobileDetailOpen(false)} />
        <aside className="creative-project-mobile-drawer" role="dialog" aria-modal="true">
          <ProjectDetail project={selectedProject} onOpenProject={onOpenProject} onDelete={() => void deleteProject(selectedProject)} onClose={() => setMobileDetailOpen(false)} />
        </aside>
      </div>}
    </> : <div className="creative-project-empty">
      <FileText size={28}/><h2>{projects.length ? '这个阶段还没有项目' : '还没有内容项目'}</h2>
      {!projects.length && <button className="button primary" type="button" onClick={() => setCreating(true)}>新建第一篇内容</button>}
    </div>}
  </section>;
}
