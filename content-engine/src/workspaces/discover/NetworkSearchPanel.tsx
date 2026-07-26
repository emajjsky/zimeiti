import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SearchPreset } from '../../app/navigation.mjs';
import { PageHeader } from '../../components/workspace/PageHeader';
import { assistedChannels, intelligenceCategories } from '../../data/intelligenceSources';
import type { LocalState } from '../../data/localRepository';

type IntelligenceItem = LocalState['intelligence'][number];

export function NetworkSearchPanel({
  preset,
  onSave,
  onOpenSearchSettings,
  checkStatus,
  searchWeb,
}: {
  preset: SearchPreset | null;
  onSave: (item: IntelligenceItem) => void;
  onOpenSearchSettings: () => void;
  checkStatus: () => Promise<{ configured?: boolean }>;
  searchWeb: (input: { query: string; category: string; domains: string[] }) => Promise<IntelligenceItem[]>;
}) {
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('科技');
  const [channelId, setChannelId] = useState('ALL');
  const [results, setResults] = useState<IntelligenceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void checkStatus()
      .then((result) => { if (active) setConfigured(Boolean(result.configured)); })
      .catch(() => { if (active) setConfigured(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [checkStatus]);

  useEffect(() => {
    if (!preset) return;
    const channel = assistedChannels.find((item) => item.label === preset.label);
    setChannelId(channel?.id ?? 'ALL');
    if (preset.defaultCategory) setCategory(preset.defaultCategory);
  }, [preset]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configured || !query.trim()) return;
    const channel = assistedChannels.find((item) => item.id === channelId);
    setBusy(true);
    setNotice('');
    try {
      const items = await searchWeb({
        query: query.trim(),
        category,
        domains: channel?.domains ?? [],
      });
      setResults(items);
      setAdded([]);
      if (!items.length) setNotice('没有找到符合当前条件的公开网页。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '搜索失败。');
    } finally {
      setBusy(false);
    }
  };

  const addResult = (item: IntelligenceItem) => {
    onSave(item);
    setAdded((current) => current.includes(item.id) ? current : [...current, item.id]);
  };

  return (
    <div className="network-search-panel">
      <PageHeader title="网络搜索" />
      {checking ? <div className="search-status-skeleton" aria-label="正在检查检索配置" /> : !configured ? (
        <section className="search-configuration-empty">
          <h2>尚未配置检索 API</h2>
          <button className="button primary" type="button" onClick={onOpenSearchSettings}>前往设置</button>
        </section>
      ) : (
        <>
          <form className="network-search-form" onSubmit={submit}>
            <label className="search-query-field">检索词<div className="input-with-icon"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></div></label>
            <label>题材<select value={category} onChange={(event) => setCategory(event.target.value)}>{intelligenceCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>来源范围<select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="ALL">全网</option>{assistedChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.label}</option>)}</select></label>
            <button className="button primary" type="submit" disabled={busy || !query.trim()}>{busy ? '搜索中' : '开始搜索'}</button>
          </form>

          <section className="network-search-results" aria-busy={busy}>
            <header><h2>候选结果</h2><span>{results.length} 条</span></header>
            {notice && <p className="inline-notice error" aria-live="polite">{notice}</p>}
            {busy ? <div className="result-skeletons"><i /><i /><i /></div> : results.length > 0 && (
              <div className="search-results">{results.map((item) => (
                <article key={item.id}>
                  <div className="search-result-copy"><b>{item.title}</b><p>{item.summary}</p><small>{item.source} / {item.category}</small></div>
                  <div className="search-result-actions"><a href={item.url} target="_blank" rel="noreferrer">查看原文</a><button className="button" type="button" disabled={added.includes(item.id)} onClick={() => addResult(item)}>{added.includes(item.id) ? '已加入' : '加入热点池'}</button></div>
                </article>
              ))}</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
