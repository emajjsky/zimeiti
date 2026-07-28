import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webProjects } from '../../data/webApi';
import { validatePlanningDraft } from '../../domain/creative-flow.mjs';
import { platformName, type ContentProject, type Platform, type ProjectPlanning, type TimingWindow } from '../../domain/content';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const platforms: Platform[] = ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'];
const timingOptions: { id: TimingWindow; label: string }[] = [
  { id: 'TODAY', label: '今天' },
  { id: 'THREE_DAYS', label: '3 天内' },
  { id: 'ONE_WEEK', label: '一周内' },
  { id: 'EVERGREEN', label: '长期有效' },
];

function datetimeInputValue(value?: string) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function PlanningWorkspace({ project, onProjectChange, onComplete }: {
  project: ContentProject;
  onProjectChange: (project: ContentProject) => void;
  onComplete: (project: ContentProject) => void;
}) {
  const [planning, setPlanning] = useState<ProjectPlanning>(project.planning);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPlanning(project.planning);
    setState('idle');
    setError('');
    void webProjects.planning(project.id).then((result) => {
      if (cancelled) return;
      setPlanning(result.planning);
      setState('saved');
      setSavedAt(result.project.updatedAt);
    }).catch((reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : '规划读取失败');
      setState('error');
    });
    return () => { cancelled = true; };
  }, [project.id]);

  const change = (patch: Partial<ProjectPlanning>) => {
    setPlanning((current) => ({ ...current, ...patch }));
    setState('dirty');
    setError('');
  };

  const togglePlatform = (platform: Platform) => {
    change({
      targetPlatforms: planning.targetPlatforms.includes(platform)
        ? planning.targetPlatforms.filter((item) => item !== platform)
        : [...planning.targetPlatforms, platform],
    });
  };

  const save = async () => {
    setState('saving');
    setError('');
    try {
      const result = await webProjects.savePlanning(project.id, planning);
      setPlanning(result.planning);
      setSavedAt(result.project.updatedAt);
      setState('saved');
      onProjectChange(result.project);
      return result.project;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '规划保存失败');
      setState('error');
      throw reason;
    }
  };

  const confirm = async () => {
    const errors = validatePlanningDraft(planning);
    if (errors.length) {
      setError(errors.join('；'));
      setState('error');
      return;
    }
    try {
      if (state !== 'saved') await save();
      setState('saving');
      const result = await webProjects.completePlanning(project.id);
      setState('saved');
      onProjectChange(result.project);
      onComplete(result.project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '规划确认失败');
      setState('error');
    }
  };

  const busy = state === 'saving';
  return <section className="planning-workspace">
    <form onSubmit={(event) => { event.preventDefault(); void save().catch(() => undefined); }}>
      <header>
        <div><h2>内容规划</h2>{project.planningConfirmedAt && <span>已确认</span>}</div>
        <button className="button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16}/> : null}{busy ? '保存中' : '保存规划'}</button>
      </header>

      <div className="planning-fields">
        <label className="wide"><span>选题标题</span><input value={planning.title} onChange={(event) => change({ title: event.target.value })} autoFocus /></label>
        <label><span>题材</span><input value={planning.category} onChange={(event) => change({ category: event.target.value })} placeholder="例如 AI 工具、财经、历史" /></label>
        <label><span>时效</span><select value={planning.timing} onChange={(event) => change({ timing: event.target.value as TimingWindow })}>{timingOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="wide"><span>创作角度</span><textarea rows={3} value={planning.angle} onChange={(event) => change({ angle: event.target.value })} placeholder="这篇内容从什么切口展开" /></label>
        <label><span>创作目标</span><textarea rows={3} value={planning.objective} onChange={(event) => change({ objective: event.target.value })} placeholder="希望读者看完获得什么" /></label>
        <label><span>目标受众</span><textarea rows={3} value={planning.targetAudience} onChange={(event) => change({ targetAudience: event.target.value })} placeholder="这篇内容主要写给谁" /></label>
        <label className="wide"><span>核心表达</span><textarea rows={4} value={planning.coreMessage} onChange={(event) => change({ coreMessage: event.target.value })} placeholder="全文必须讲清楚的一句话" /></label>
        <fieldset className="wide"><legend>目标平台</legend><div>{platforms.map((platform) => <label key={platform}><input type="checkbox" checked={planning.targetPlatforms.includes(platform)} onChange={() => togglePlatform(platform)} /><span>{platformName[platform]}</span></label>)}</div></fieldset>
        <label className="wide planning-publish-field"><span>计划发布时间</span><input type="datetime-local" value={datetimeInputValue(planning.plannedPublishAt)} onChange={(event) => change({ plannedPublishAt: event.target.value || undefined })} /></label>
        <label className="wide"><span>来源与核验要求</span><textarea rows={4} value={planning.sourceRequirements} onChange={(event) => change({ sourceRequirements: event.target.value })} placeholder="需要检索、引用或再次核验的事实" /></label>
        <label className="wide"><span>禁止表达与必须保留内容</span><textarea rows={4} value={planning.constraints} onChange={(event) => change({ constraints: event.target.value })} placeholder="不希望出现的说法，以及必须保留的观点、案例或原话" /></label>
      </div>

      <footer>
        <div className={`planning-save-state ${state}`} aria-live="polite">
          {state === 'saved' && <><CheckCircle2 size={16}/><span>已保存{savedAt ? ` ${new Date(savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span></>}
          {state === 'dirty' && <span>有未保存修改</span>}
          {state === 'error' && <><CircleAlert size={16}/><span>{error}</span></>}
        </div>
        {project.stage === 'PLANNING' && <button className="button primary" type="button" disabled={busy} onClick={() => void confirm()}>确认规划，开始研究</button>}
      </footer>
    </form>
  </section>;
}
