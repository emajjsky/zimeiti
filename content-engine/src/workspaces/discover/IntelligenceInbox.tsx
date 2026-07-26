import { RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/workspace/PageHeader';
import type { LocalState } from '../../data/localRepository';
import { filterIntelligenceItems, intelligenceSourceLabel } from '../../../shared/intelligence-filters.mjs';
import { formatIntelligenceTime, toneForValue } from '../../../shared/intelligence-presentation.mjs';

type Feedback = { status: 'idle' | 'running' | 'success' | 'empty' | 'error'; message: string };
type AnalysisFeedback = { status: 'idle' | 'running' | 'error'; message: string };

export function IntelligenceInbox({
  item,
  intelligence,
  sources,
  topics,
  projects,
  onSelect,
  onCreateTopic,
  onOpenTopic,
  onRefresh,
  onOpenSources,
  refreshFeedback,
  analysisFeedback,
  onAnalyze,
}: {
  item?: LocalState['intelligence'][number];
  intelligence: LocalState['intelligence'];
  sources: LocalState['sources'];
  topics: LocalState['topics'];
  projects: LocalState['projects'];
  onSelect: (id: string) => void;
  onCreateTopic: () => void;
  onOpenTopic: (sourceId: string) => void;
  onRefresh: () => void;
  onOpenSources: () => void;
  refreshFeedback: Feedback;
  analysisFeedback: AnalysisFeedback;
  onAnalyze: () => void;
}) {
  const [category, setCategory] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [timeRange, setTimeRange] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK');
  const [projectState, setProjectState] = useState<'ALL' | 'PROJECTED' | 'UNPROJECTED'>('ALL');
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const categories = useMemo(() => [...new Set(intelligence.map((entry) => entry.category).filter(Boolean))], [intelligence]);
  const sourceNames = useMemo(() => [...new Set(intelligence.map(intelligenceSourceLabel).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')), [intelligence]);
  const projectTitles = useMemo(() => new Set(projects.map((project) => project.title)), [projects]);
  const projectedIds = useMemo(() => new Set(
    topics
      .filter((topic) => topic.status === 'PROJECT_CREATED' && projectTitles.has(topic.title))
      .flatMap((topic) => topic.sourceIds),
  ), [topics, projectTitles]);
  const filtered = filterIntelligenceItems(intelligence, { category, source, language: 'ALL', timeRange, query });
  const visible = filtered.filter((entry) => projectState === 'ALL' || (projectState === 'PROJECTED' ? projectedIds.has(entry.id) : !projectedIds.has(entry.id)));
  const selected = visible.find((entry) => entry.id === item?.id) ?? visible[0];

  const select = (id: string) => {
    onSelect(id);
    setDrawerOpen(true);
  };

  const keywordTags = (entry: LocalState['intelligence'][number]) => [...new Set(entry.keywords ?? [])].filter((keyword) => keyword && keyword !== entry.category).slice(0, 2);

  return (
    <div className="intelligence-inbox">
      <PageHeader
        title="热点情报"
        actions={<button className="button primary" type="button" onClick={onRefresh} disabled={refreshFeedback.status === 'running'}><RefreshCw className={refreshFeedback.status === 'running' ? 'spin' : ''} size={16} />{refreshFeedback.status === 'running' ? '正在刷新' : '刷新热点'}</button>}
        feedback={refreshFeedback.status !== 'idle' ? <span className={`refresh-message ${refreshFeedback.status}`}>{refreshFeedback.message}</span> : undefined}
      />

      <div className="intelligence-filters">
        <select aria-label="时间范围" value={timeRange} onChange={(event) => setTimeRange(event.target.value as 'DAY' | 'WEEK' | 'MONTH')}><option value="DAY">今天</option><option value="WEEK">近 7 天</option><option value="MONTH">近 30 天</option></select>
        <select aria-label="来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">全部来源</option>{sourceNames.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="题材" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">全部题材</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="立项状态" value={projectState} onChange={(event) => setProjectState(event.target.value as 'ALL' | 'PROJECTED' | 'UNPROJECTED')}><option value="ALL">全部状态</option><option value="PROJECTED">已立项</option><option value="UNPROJECTED">未立项</option></select>
        <label className="filter-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、摘要或关键词" /></label>
      </div>

      {intelligence.length === 0 ? (
        <section className="inbox-empty-state"><h2>热点池还是空的</h2><div><button className="button" type="button" onClick={onOpenSources}>配置资讯来源</button></div></section>
      ) : visible.length === 0 ? (
        <section className="inbox-empty-state"><h2>没有符合当前条件的情报</h2></section>
      ) : (
        <section className="intelligence-grid" aria-label="热点情报列表">
          {visible.map((entry) => (
            <button className="intelligence-card" type="button" key={entry.id} onClick={() => select(entry.id)}>
              <header className={`intelligence-source-bar ${toneForValue(intelligenceSourceLabel(entry))}`}><span>{intelligenceSourceLabel(entry)}</span>{projectedIds.has(entry.id) && <em>已立项</em>}</header>
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              <div className="intelligence-tags"><span className={toneForValue(entry.category || '其它')}>{entry.category || '其它'}</span>{keywordTags(entry).map((keyword) => <span className={toneForValue(keyword)} key={keyword}>{keyword}</span>)}</div>
              <footer><time>{formatIntelligenceTime(entry.publishedAt)}</time><span>查看详情</span></footer>
            </button>
          ))}
        </section>
      )}

      {drawerOpen && selected && (
        <>
          <button className="drawer-backdrop" type="button" aria-label="关闭详情" onClick={() => setDrawerOpen(false)} />
          <aside className="intelligence-drawer" aria-label="情报详情">
            <header><span className={toneForValue(selected.category || '其它')}>{selected.category || '其它'}</span><button className="icon-button" type="button" aria-label="关闭详情" onClick={() => setDrawerOpen(false)}><X size={19} /></button></header>
            <h2>{selected.title}</h2>
            <div className="drawer-meta"><span>{intelligenceSourceLabel(selected)}</span><span>{formatIntelligenceTime(selected.publishedAt)}</span></div>
            <p>{selected.summary}</p>
            {selected.analysis && <section className="drawer-analysis"><h3>建议角度</h3><p>{selected.analysis.suggestedAngle}</p></section>}
            {selected.analysis?.factsToVerify.length ? <section className="drawer-facts"><h3>待核验</h3><p>{selected.analysis.factsToVerify.join('；')}</p></section> : null}
            {selected.url && <a className="source-link" href={selected.url} target="_blank" rel="noreferrer">查看原文</a>}
            {analysisFeedback.status === 'error' && <p className="inline-notice error">{analysisFeedback.message}</p>}
            <footer><button className="button" type="button" disabled={analysisFeedback.status === 'running'} onClick={onAnalyze}>{analysisFeedback.status === 'running' ? '分析中' : 'AI 分析'}</button><button className="button primary" type="button" onClick={() => projectedIds.has(selected.id) ? onOpenTopic(selected.id) : onCreateTopic()}>{projectedIds.has(selected.id) ? '查看选题' : '创建选题'}</button></footer>
          </aside>
        </>
      )}
    </div>
  );
}
