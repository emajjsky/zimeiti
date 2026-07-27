import { Bot, Check, CircleAlert, FileCheck2, LoaderCircle, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webCreative } from '../../data/webApi';
import type { ProjectResearchContext } from '../../domain/creative';

const actionNames = { SEARCH_WEB: '网络搜索', READ_LINK: '读取链接', ASK_USER: '补充资料' } as const;
const priorityNames = { HIGH: '高', MEDIUM: '中', LOW: '低' } as const;

export function ProjectResearchAgent({ projectId, context, selectedInputIds, selectedReferenceIds, onContext, onOpenSettings }: {
  projectId: string;
  context: ProjectResearchContext | null;
  selectedInputIds: string[];
  selectedReferenceIds: string[];
  onContext: (value: ProjectResearchContext) => void;
  onOpenSettings: () => void;
}) {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'idle' | 'preparing' | 'confirming' | 'cancelling'>('idle');
  const [error, setError] = useState('');
  const selectedCount = selectedInputIds.length + selectedReferenceIds.length;

  const reload = async () => {
    const result = await webCreative.research(projectId);
    onContext(result);
    return result;
  };

  useEffect(() => {
    const status = context?.run?.status;
    if (status !== 'QUEUED' && status !== 'RUNNING') return;
    let cancelled = false;
    const refresh = async () => {
      try { const result = await webCreative.research(projectId); if (!cancelled) onContext(result); }
      catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : '研究任务状态更新失败。'); }
    };
    const timer = window.setInterval(() => { void refresh(); }, 1_500);
    void refresh();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [context?.run?.status, onContext, projectId]);

  const prepare = async () => {
    if (!request.trim() || selectedCount === 0) return;
    setBusy('preparing'); setError('');
    try {
      await webCreative.prepareResearch(projectId, { request: request.trim(), inputIds: selectedInputIds, referenceIds: selectedReferenceIds });
      setRequest('');
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '研究计划准备失败。'); }
    finally { setBusy('idle'); }
  };

  const confirm = async () => {
    if (!context?.run || context.run.status !== 'DRAFT') return;
    setBusy('confirming'); setError('');
    try { await webCreative.confirmResearch(context.run.id); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '研究计划启动失败。'); }
    finally { setBusy('idle'); }
  };

  const cancel = async () => {
    if (!context?.run || !['DRAFT', 'QUEUED'].includes(context.run.status)) return;
    setBusy('cancelling'); setError('');
    try { await webCreative.cancelResearch(context.run.id); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消失败。'); }
    finally { setBusy('idle'); }
  };

  const run = context?.run;
  const runIsActive = Boolean(run && ['DRAFT', 'QUEUED', 'RUNNING'].includes(run.status));
  return <aside className="project-research-agent" aria-label="项目 Agent">
    <header><div><Bot size={19}/><h2>项目 Agent</h2></div><span>研究计划</span></header>
    <div className="project-agent-thread">
      {!context?.messages.length && <div className="project-agent-empty"><FileCheck2 size={22}/><b>选择资料后提出任务</b></div>}
      {context?.messages.map((message) => <article key={message.id} className={`project-agent-message ${message.role.toLowerCase()}`}><span>{message.role === 'USER' ? '你' : 'Agent'}</span><p>{message.content}</p></article>)}
      {run?.status === 'DRAFT' && <section className="research-confirmation">
        <div><b>生成研究计划</b><span>{run.actionVersion}</span></div>
        <dl><div><dt>模型</dt><dd>{run.model}</dd></div><div><dt>资料</dt><dd>{run.materialCount} 条</dd></div></dl>
        <footer><button className="icon-button" type="button" aria-label="取消研究计划" disabled={busy !== 'idle'} onClick={() => void cancel()}><X size={16}/></button><button className="button primary" type="button" disabled={busy !== 'idle'} onClick={() => void confirm()}>{busy === 'confirming' ? <LoaderCircle size={15}/> : <Check size={15}/>}确认调用</button></footer>
      </section>}
      {run && ['QUEUED', 'RUNNING'].includes(run.status) && <div className="research-running" aria-live="polite"><LoaderCircle size={18}/><b>{run.status === 'QUEUED' ? '等待核心 Agent' : '正在生成研究计划'}</b>{run.status === 'QUEUED' && <button className="text-button" type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>{busy === 'cancelling' ? '取消中' : '取消'}</button>}</div>}
      {run?.status === 'FAILED' && <div className="research-run-error"><CircleAlert size={17}/><div><b>生成失败</b><p>{run.error}</p></div></div>}
      {context?.plan && <section className="research-plan-result">
        <header><span>{runIsActive ? '最近完成计划' : '研究计划'}</span><b>{context.plan.title}</b></header>
        <p>{context.plan.summary}</p>
        <div className="research-plan-block"><b>待回答问题</b><ol>{context.plan.questions.map((item) => <li key={item.question}><span>{item.question}</span><small>{item.preferredSources.join('、')}</small></li>)}</ol></div>
        {context.plan.claims.length > 0 && <div className="research-plan-block"><b>待核验主张</b><ul>{context.plan.claims.map((item) => <li key={item.claim}><span className={`priority-${item.priority.toLowerCase()}`}>{priorityNames[item.priority]}</span>{item.claim}</li>)}</ul></div>}
        <div className="research-plan-actions">{context.plan.nextActions.map((item) => <div key={`${item.action}-${item.target}`}><span>{actionNames[item.action]}</span><p>{item.purpose}</p><small>{item.target}</small></div>)}</div>
      </section>}
    </div>
    {error && <div className="project-agent-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{/核心 Agent/.test(error) && <button className="text-button" type="button" onClick={onOpenSettings}>去配置</button>}</div>}
    <div className="project-agent-composer">
      <div><span>已选 {selectedCount} 条资料</span>{selectedCount === 0 && <em>请先在左侧选择</em>}</div>
      <textarea rows={3} value={request} maxLength={2_000} placeholder="例如：保留我的观点，核验关键数据，先生成公众号研究计划" onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void prepare(); }}/>
      <button className="button primary" type="button" title="准备研究计划" disabled={!request.trim() || selectedCount === 0 || busy !== 'idle' || runIsActive} onClick={() => void prepare()}>{busy === 'preparing' ? <LoaderCircle size={16}/> : <Send size={16}/>}准备计划</button>
    </div>
  </aside>;
}
