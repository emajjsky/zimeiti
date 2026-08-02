import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { webProjects } from '../../data/webApi';
import { validatePlanningDraft } from '../../domain/creative-flow.mjs';
import type { ContentProject, ProjectPlanning, TimingWindow } from '../../domain/content';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const timingOptions: { id: TimingWindow; label: string }[] = [
  { id: 'TODAY', label: '今天' },
  { id: 'THREE_DAYS', label: '3 天内' },
  { id: 'ONE_WEEK', label: '一周内' },
  { id: 'EVERGREEN', label: '长期有效' },
];

export function PlanningWorkspace({ project, onProjectChange, onComplete }: {
  project: ContentProject;
  onProjectChange: (project: ContentProject) => void;
  onComplete: (project: ContentProject) => void;
}) {
  const normalizePlanning = (value: ProjectPlanning): ProjectPlanning => ({ ...value, targetPlatforms: ['WECHAT'] });
  const [planning, setPlanning] = useState<ProjectPlanning>(() => normalizePlanning(project.planning));
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const pendingSave = useRef<Promise<ContentProject> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlanning(normalizePlanning(project.planning)); setState('idle'); setError('');
    void webProjects.planning(project.id).then((result) => {
      if (cancelled) return;
      setPlanning(normalizePlanning(result.planning)); setState('saved'); setSavedAt(result.project.updatedAt);
    }).catch((reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : '规划读取失败'); setState('error');
    });
    return () => { cancelled = true; };
  }, [project.id]);

  const save = (snapshot = planning) => {
    const normalized = normalizePlanning(snapshot);
    const request = (async () => {
      setState('saving'); setError('');
      try {
        const result = await webProjects.savePlanning(project.id, normalized);
        setPlanning(normalizePlanning(result.planning)); setSavedAt(result.project.updatedAt); setState('saved'); onProjectChange(result.project);
        return result.project;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '规划保存失败'); setState('error');
        throw reason;
      }
    })();
    pendingSave.current = request;
    return request;
  };

  useEffect(() => {
    if (state !== 'dirty') return;
    const snapshot = planning;
    const timer = window.setTimeout(() => { void save(snapshot).catch(() => undefined); }, 700);
    return () => window.clearTimeout(timer);
  }, [planning, state]);

  const change = (patch: Partial<ProjectPlanning>) => {
    setPlanning((current) => ({ ...current, ...patch })); setState('dirty'); setError('');
  };

  const confirm = async () => {
    const errors = validatePlanningDraft(planning);
    if (errors.length) { setError(errors.join('；')); setState('error'); return; }
    try {
      if (state === 'dirty') await save();
      if (state === 'saving') await pendingSave.current;
      setState('saving');
      const result = await webProjects.completePlanning(project.id);
      setState('saved'); onProjectChange(result.project); onComplete(result.project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '规划确认失败'); setState('error');
    }
  };

  const busy = state === 'saving';
  return <section className="planning-workspace">
    <div className="planning-card">
      <header>
        <div><h2>内容规划</h2>{project.planningConfirmedAt && <span>已确认</span>}</div>
        <div className={`planning-save-state ${state}`} aria-live="polite">
          {state === 'saving' && <><LoaderCircle size={15}/><span>正在保存</span></>}
          {state === 'saved' && <><CheckCircle2 size={15}/><span>已自动保存{savedAt ? ` ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}` : ''}</span></>}
          {state === 'dirty' && <span>准备自动保存</span>}
          {state === 'error' && <><CircleAlert size={15}/><span>{error}</span><button className="text-button" type="button" onClick={() => void save().catch(() => undefined)}>重试保存</button></>}
        </div>
      </header>

      <div className="planning-fields">
        <label className="wide"><span>选题标题</span><input value={planning.title} onChange={(event) => change({ title: event.target.value })} autoFocus /></label>
        <label><span>时效</span><select value={planning.timing} onChange={(event) => change({ timing: event.target.value as TimingWindow })}>{timingOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="wide"><span>补充要求</span><textarea rows={3} value={planning.constraints} onChange={(event) => change({ constraints: event.target.value })} placeholder="可选：想保留的素材、表达方式或特别要求" /></label>
      </div>

      <details className="planning-details"><summary>查看规划详情</summary><div className="planning-fields">
        <label><span>题材</span><input value={planning.category} onChange={(event) => change({ category: event.target.value })} placeholder="例如 AI 工具、财经、历史" /></label>
        <label><span>研究要求</span><input value={planning.sourceRequirements} onChange={(event) => change({ sourceRequirements: event.target.value })} placeholder="可选" /></label>
        <label className="wide"><span>创作角度</span><textarea rows={2} value={planning.angle} onChange={(event) => change({ angle: event.target.value })} /></label>
        <label><span>创作目标</span><textarea rows={2} value={planning.objective} onChange={(event) => change({ objective: event.target.value })} /></label>
        <label><span>目标受众</span><textarea rows={2} value={planning.targetAudience} onChange={(event) => change({ targetAudience: event.target.value })} /></label>
        <label className="wide"><span>核心表达</span><textarea rows={2} value={planning.coreMessage} onChange={(event) => change({ coreMessage: event.target.value })} /></label>
      </div></details>

      <footer>{project.stage === 'PLANNING' && <button className="button primary" type="button" disabled={busy} onClick={() => void confirm()}>确认内容准备</button>}</footer>
    </div>
  </section>;
}
