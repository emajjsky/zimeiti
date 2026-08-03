import { BrainCircuit, CheckCircle2, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/workspace/PageHeader';
import type { LocalState } from '../../data/localRepository';
import { webIntelligence, type AnalysisPreparation } from '../../data/webApi';
import type { IntelligenceAnalysis } from '../../domain/content';
import { filterIntelligenceItems, intelligenceSourceLabel } from '../../../shared/intelligence-filters.mjs';
import { formatIntelligenceTime, projectForIntelligence, toneForValue } from '../../../shared/intelligence-presentation.mjs';

type Feedback = { status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string };
type AnalysisState = { status: 'idle' | 'preparing' | 'confirming' | 'running' | 'error'; message: string };

const dimensionNames = { timeliness: '时效性', accountFit: '账号匹配', contentValue: '内容价值', spreadPotential: '传播潜力', feasibilityAndSafety: '可执行与风险' } as const;
const decisionNames = { FOLLOW: '建议跟进', WATCH: '继续观察', SKIP: '暂不建议' } as const;
const timingNames = { TODAY: '建议今天发布', THREE_DAYS: '三天内有效', ONE_WEEK: '一周内有效', EVERGREEN: '可长期跟进' } as const;

export function IntelligenceInbox({
  item, intelligence, sources, projects, onSelect, onAddToCreative, onOpenProject, onSaveAnalysis, onRefresh, onOpenSources, refreshFeedback,
}: {
  item?: LocalState['intelligence'][number];
  intelligence: LocalState['intelligence'];
  sources: LocalState['sources'];
  projects: LocalState['projects'];
  onSelect: (id: string) => void;
  onAddToCreative: (itemId: string, analysis?: IntelligenceAnalysis, angleIndex?: number) => void;
  onOpenProject: (projectId: string) => void;
  onSaveAnalysis: (itemId: string, analysis: IntelligenceAnalysis) => void;
  onRefresh: () => void;
  onOpenSources: () => void;
  refreshFeedback: Feedback;
}) {
  const [category, setCategory] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [timeRange, setTimeRange] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK');
  const [projectState, setProjectState] = useState<'ALL' | 'PROJECTED' | 'UNPROJECTED'>('ALL');
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prepared, setPrepared] = useState<AnalysisPreparation | null>(null);
  const [analysis, setAnalysis] = useState<IntelligenceAnalysis | undefined>();
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'idle', message: '' });
  const [angleIndex, setAngleIndex] = useState(0);
  const pollingJobId = useRef<string | null>(null);

  const categories = useMemo(() => [...new Set(intelligence.map((entry) => entry.category).filter(Boolean))], [intelligence]);
  const sourceNames = useMemo(() => [...new Set(intelligence.map(intelligenceSourceLabel).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')), [intelligence]);
  const projectedIds = useMemo(() => new Set(projects.filter((project) => project.originType === 'HOTSPOT' && project.originReferenceId).map((project) => project.originReferenceId as string)), [projects]);
  const filtered = filterIntelligenceItems(intelligence, { category, source, language: 'ALL', timeRange, query });
  const visible = filtered.filter((entry) => projectState === 'ALL' || (projectState === 'PROJECTED' ? projectedIds.has(entry.id) : !projectedIds.has(entry.id)));
  const selected = visible.find((entry) => entry.id === item?.id) ?? visible[0];

  const resumeAnalysisPolling = async (itemId: string, jobId: string) => {
    if (pollingJobId.current === jobId) return;
    pollingJobId.current = jobId;
    setAnalysisState({ status: 'running', message: '分析中' });
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const job = await webIntelligence.job(jobId);
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.error || '分析任务未完成。');
        if (job.status !== 'SUCCEEDED') continue;
        const result = await webIntelligence.latestAnalysis(itemId);
        if (!result) throw new Error('分析完成但未读取到结果。');
        setAnalysis(result); onSaveAnalysis(itemId, result); setAnalysisState({ status: 'idle', message: '' }); return;
      }
      setAnalysisState({ status: 'error', message: '任务仍在队列中，请稍后重新打开详情查看结果。' });
    } catch (error) { setAnalysisState({ status: 'error', message: error instanceof Error ? error.message : '分析失败。' }); }
    finally { if (pollingJobId.current === jobId) pollingJobId.current = null; }
  };

  useEffect(() => {
    if (!drawerOpen || !selected) return;
    setPrepared(null); setAngleIndex(0); setAnalysis(selected.analysis); setAnalysisState({ status: 'idle', message: '' });
    void Promise.all([webIntelligence.latestAnalysis(selected.id), webIntelligence.latestAnalysisRun(selected.id)]).then(([result, run]) => {
      if (result) { setAnalysis(result); onSaveAnalysis(selected.id, result); }
      if (!run || run.status === 'SUCCEEDED' || run.status === 'CANCELLED') return;
      if (run.status === 'DRAFT') {
        setPrepared({
          id: run.id,
          status: 'DRAFT',
          createdAt: run.createdAt,
          confirmation: run.confirmation,
        });
        return;
      }
      if (run.status === 'FAILED') { setAnalysisState({ status: 'error', message: run.error || '分析失败。' }); return; }
      if (run.jobId) void resumeAnalysisPolling(selected.id, run.jobId);
    }).catch(() => { /* 历史分析读取失败不阻断当前详情。 */ });
  }, [drawerOpen, selected?.id]);

  const select = (id: string) => { onSelect(id); setDrawerOpen(true); };
  const keywordTags = (entry: LocalState['intelligence'][number]) => [...new Set(entry.keywords ?? [])].filter((keyword) => keyword && keyword !== entry.category).slice(0, 2);

  const prepare = async () => {
    if (!selected) return;
    setAnalysisState({ status: 'preparing', message: '' });
    try {
      const result = await webIntelligence.prepareAnalysis(selected.id);
      setPrepared(result); setAnalysisState({ status: 'idle', message: '' });
    } catch (error) { setAnalysisState({ status: 'error', message: error instanceof Error ? error.message : '准备分析失败。' }); }
  };

  const confirm = async () => {
    if (!selected || !prepared) return;
    setAnalysisState({ status: 'confirming', message: '' });
    try {
      const confirmed = await webIntelligence.confirmAnalysis(prepared.id);
      setPrepared(null); void resumeAnalysisPolling(selected.id, confirmed.jobId);
    } catch (error) { setAnalysisState({ status: 'error', message: error instanceof Error ? error.message : '分析失败。' }); }
  };

  const cancelPrepared = async () => {
    if (!prepared) return;
    try { await webIntelligence.cancelAnalysis(prepared.id); } catch { /* 取消请求失败时关闭确认卡，服务端状态仍由下一次查询判定。 */ }
    setPrepared(null); setAnalysisState({ status: 'idle', message: '' });
  };

  return <div className="intelligence-inbox">
    <PageHeader title="热点情报" actions={<button className="button primary" type="button" onClick={onRefresh} disabled={refreshFeedback.status === 'running'}>{refreshFeedback.status === 'running' ? '正在刷新' : '刷新热点'}</button>} feedback={refreshFeedback.status !== 'idle' ? <span className={`refresh-message ${refreshFeedback.status}`}>{refreshFeedback.message}</span> : undefined} />
    <div className="intelligence-filters">
      <select aria-label="时间范围" value={timeRange} onChange={(event) => setTimeRange(event.target.value as 'DAY' | 'WEEK' | 'MONTH')}><option value="DAY">今天</option><option value="WEEK">近 7 天</option><option value="MONTH">近 30 天</option></select>
      <select aria-label="来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">全部来源</option>{sourceNames.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="题材" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">全部题材</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="创作状态" value={projectState} onChange={(event) => setProjectState(event.target.value as 'ALL' | 'PROJECTED' | 'UNPROJECTED')}><option value="ALL">全部状态</option><option value="PROJECTED">已加入创作</option><option value="UNPROJECTED">未加入创作</option></select>
      <label className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要或关键词" /></label>
    </div>
    {intelligence.length === 0 ? <section className="inbox-empty-state"><h2>热点池还是空的</h2><div><button className="button" type="button" onClick={onOpenSources}>配置资讯来源</button></div></section> : visible.length === 0 ? <section className="inbox-empty-state"><h2>没有符合当前条件的情报</h2></section> : <section className="intelligence-grid" aria-label="热点情报列表">{visible.map((entry) => <button className="intelligence-card" type="button" key={entry.id} onClick={() => select(entry.id)}><header className={`intelligence-source-bar ${toneForValue(intelligenceSourceLabel(entry))}`}><span>{intelligenceSourceLabel(entry)}</span><div className="intelligence-card-status">{entry.analysis && <em className="analyzed">已分析</em>}{projectedIds.has(entry.id) && <em>已加入</em>}</div></header><h2>{entry.title}</h2><p>{entry.summary}</p><div className="intelligence-tags"><span className={toneForValue(entry.category || '其它')}>{entry.category || '其它'}</span>{keywordTags(entry).map((keyword) => <span className={toneForValue(keyword)} key={keyword}>{keyword}</span>)}</div><footer><time>{formatIntelligenceTime(entry.publishedAt)}</time><span>查看详情</span></footer></button>)}</section>}
    {drawerOpen && selected && <><button className="drawer-backdrop" type="button" aria-label="关闭详情" onClick={() => setDrawerOpen(false)} /><aside className="intelligence-drawer" aria-label="情报详情"><header><span className={toneForValue(selected.category || '其它')}>{selected.category || '其它'}</span><button className="icon-button" type="button" aria-label="关闭详情" onClick={() => setDrawerOpen(false)}><X size={19} /></button></header><h2>{selected.title}</h2><div className="drawer-meta"><span>{intelligenceSourceLabel(selected)}</span><span>{formatIntelligenceTime(selected.publishedAt)}</span></div><p>{selected.summary}</p>
      {analysis && <AnalysisResult analysis={analysis} angleIndex={angleIndex} onAngle={setAngleIndex} />}
      {selected.url && <a className="source-link" href={selected.url} target="_blank" rel="noreferrer">查看原文</a>}
      {analysisState.status === 'error' && <p className="inline-notice error">{analysisState.message}</p>}
      {prepared ? <section className="analysis-confirmation"><div><b>{prepared.confirmation.model}</b><small>模板 V{prepared.confirmation.promptVersion} · 公众号母稿</small></div>{prepared.confirmation.generalAudienceWarning && <p>将按通用受众分析</p>}<footer><button className="button" type="button" onClick={() => void cancelPrepared()}>取消</button><button className="button primary" type="button" onClick={() => void confirm()} disabled={analysisState.status === 'confirming'}>{analysisState.status === 'confirming' ? '提交中' : '确认分析'}</button></footer></section> : <section className="analysis-controls"><span>按公众号母稿评估</span><button className="button" type="button" disabled={analysisState.status === 'preparing' || analysisState.status === 'running'} onClick={() => void prepare()}>{analysisState.status === 'running' ? <LoaderCircle className="spin" size={16} /> : <BrainCircuit size={16} />}{analysisState.status === 'preparing' ? '准备中' : analysisState.status === 'running' ? '分析中' : 'AI 分析'}</button></section>}
      <footer>{projectForIntelligence(projects, selected.id) ? <button className="button primary" type="button" onClick={() => onOpenProject(projectForIntelligence(projects, selected.id)!.id)}>继续创作</button> : <button className="button primary" type="button" onClick={() => onAddToCreative(selected.id, analysis, angleIndex)}>加入创作</button>}</footer></aside></>}
  </div>;
}

function AnalysisResult({ analysis, angleIndex, onAngle }: { analysis: IntelligenceAnalysis; angleIndex: number; onAngle: (index: number) => void }) {
  return <section className="analysis-result"><header className="analysis-result-head"><div><span className={`analysis-decision ${analysis.decision.toLowerCase()}`}>{decisionNames[analysis.decision]}</span><b>{analysis.overallScore}</b><small>/ 100</small></div><p>{timingNames[analysis.timingWindow]}</p></header><p className="analysis-reason">{analysis.decisionReason}</p><div className="analysis-dimensions">{(Object.keys(dimensionNames) as (keyof typeof dimensionNames)[]).map((key) => <div key={key}><span>{dimensionNames[key]}</span><b>{analysis.dimensions[key].score}</b><p>{analysis.dimensions[key].reason}</p></div>)}</div>{analysis.angles.length > 0 && <section className="analysis-angles"><h3>推荐角度</h3>{analysis.angles.map((angle, index) => <button type="button" className={angleIndex === index ? 'selected' : ''} key={angle.title} onClick={() => onAngle(index)}><CheckCircle2 size={16}/><span><b>{angle.title}</b><small>{angle.coreViewpoint}</small></span></button>)}</section>}{(analysis.factsToVerify.length > 0 || analysis.risks.length > 0) && <section className="analysis-risks">{analysis.factsToVerify.length > 0 && <div><h3>待核验</h3><p>{analysis.factsToVerify.join('；')}</p></div>}{analysis.risks.length > 0 && <div><h3>风险提示</h3><p>{analysis.risks.join('；')}</p></div>}</section>}</section>;
}
