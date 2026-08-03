import { ArrowRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { webCreative } from '../../data/webApi';
import type { ContentProject } from '../../domain/content';
import { PlanningWorkspace } from './PlanningWorkspace';
import { ProjectAgent } from './ProjectAgent';
import { ProjectMaterials } from './ProjectMaterials';

export function PreparationWorkspace({ project, onProjectChange, onContinue, onOpenAgentSettings, onOpenSearchSettings }: {
  project: ContentProject;
  onProjectChange: (project: ContentProject) => void;
  onContinue: () => void;
  onOpenAgentSettings: () => void;
  onOpenSearchSettings: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const planningConfirmed = project.stage !== 'PLANNING';

  const startCopy = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (project.stage === 'RESEARCH') {
        const result = await webCreative.skipResearch(project.id);
        onProjectChange(result.project);
      }
      onContinue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '进入公众号正文失败。');
    } finally {
      setBusy(false);
    }
  };

  return <section className="preparation-workspace">
    <PlanningWorkspace project={project} onProjectChange={onProjectChange} onComplete={onProjectChange}/>
    {planningConfirmed && <>
      <div className="project-research-layout">
        <ProjectMaterials project={project} platforms={['WECHAT']}/>
        <ProjectAgent projectId={project.id} stage="RESEARCH" onArtifactAccepted={(_artifact, nextProject) => { if (nextProject) { onProjectChange(nextProject); onContinue(); } }} onOpenSettings={(target) => target === 'search' ? onOpenSearchSettings() : onOpenAgentSettings()}/>
      </div>
      {error && <div className="creative-stage-error" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}
      <footer className="preparation-primary-action">
        <button className="button primary" type="button" disabled={busy} onClick={() => void startCopy()}>{busy ? <LoaderCircle size={16}/> : <ArrowRight size={16}/>}开始公众号正文</button>
      </footer>
    </>}
  </section>;
}
