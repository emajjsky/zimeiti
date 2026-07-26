import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { automaticSourceGroups, intelligenceCategories } from '../../data/intelligenceSources';
import type { IntelligenceSource } from '../../domain/content';

export type NewSourceInput = Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>;

const emptyDraft = (): NewSourceInput => ({
  name: '',
  type: 'RSS',
  url: '',
  category: '科技',
  includeKeywords: [],
  excludeKeywords: [],
  language: 'ALL',
  enabled: true,
  refreshMinutes: 60,
  trust: '待核验',
});

const splitKeywords = (value: string) => value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
const joinKeywords = (values: string[]) => values.join('、');

export function SourceSettings({
  sources,
  onAddSource,
  onAddSources,
  onUpdateSource,
  onRemoveSource,
}: {
  sources: IntelligenceSource[];
  onAddSource: (source: NewSourceInput) => void | Promise<void>;
  onAddSources: (sources: NewSourceInput[]) => void | Promise<void>;
  onUpdateSource: (id: string, source: NewSourceInput) => Promise<void>;
  onRemoveSource: (id: string) => void | Promise<void>;
}) {
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<NewSourceInput>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NewSourceInput>(emptyDraft);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const existingUrls = useMemo(() => new Set(sources.map((source) => source.url)), [sources]);

  const togglePreset = (url: string) => {
    setSelectedUrls((current) => current.includes(url) ? current.filter((item) => item !== url) : [...current, url]);
  };

  const addSelected = async () => {
    const additions = automaticSourceGroups
      .flatMap((group) => group.sources)
      .filter((source) => selectedUrls.includes(source.url) && !existingUrls.has(source.url));
    if (!additions.length) return;
    setBusyId('catalog');
    setNotice(null);
    try {
      await onAddSources(additions);
      setSelectedUrls([]);
      setNotice({ type: 'success', text: `已接入 ${additions.length} 个来源` });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '添加来源失败。' });
    } finally {
      setBusyId(null);
    }
  };

  const addCustom = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      new URL(customDraft.url);
      setBusyId('custom');
      await onAddSource({ ...customDraft, name: customDraft.name.trim() || '未命名 RSS 源', url: customDraft.url.trim() });
      setCustomDraft(emptyDraft());
      setCustomOpen(false);
      setNotice({ type: 'success', text: '自定义 RSS 已接入' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '请输入有效的 RSS 地址。' });
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (source: IntelligenceSource) => {
    setEditingId(source.id);
    setEditDraft({
      name: source.name,
      type: source.type,
      url: source.url,
      category: source.category,
      includeKeywords: source.includeKeywords ?? [],
      excludeKeywords: source.excludeKeywords ?? [],
      language: source.language,
      enabled: source.enabled,
      refreshMinutes: source.refreshMinutes,
      trust: source.trust,
    });
    setNotice(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusyId(editingId);
    setNotice(null);
    try {
      await onUpdateSource(editingId, editDraft);
      setEditingId(null);
      setNotice({ type: 'success', text: '来源设置已保存' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存来源失败。' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (source: IntelligenceSource) => {
    setBusyId(source.id);
    setNotice(null);
    try {
      await onUpdateSource(source.id, {
        name: source.name,
        type: source.type,
        url: source.url,
        category: source.category,
        includeKeywords: source.includeKeywords ?? [],
        excludeKeywords: source.excludeKeywords ?? [],
        language: source.language,
        enabled: !source.enabled,
        refreshMinutes: source.refreshMinutes,
        trust: source.trust,
      });
      setNotice({ type: 'success', text: source.enabled ? '来源已停用' : '来源已启用' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '更新来源失败。' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (source: IntelligenceSource) => {
    if (!window.confirm(`确定删除“${source.name}”吗？`)) return;
    setBusyId(source.id);
    setNotice(null);
    try {
      await onRemoveSource(source.id);
      setNotice({ type: 'success', text: '来源已删除' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '删除来源失败。' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="source-settings">
      <header className="settings-section-header">
        <h1>资讯来源</h1>
        <button className="button" type="button" onClick={() => setCustomOpen((open) => !open)}>
          {customOpen ? <X size={16} /> : <Plus size={16} />}
          {customOpen ? '取消' : '自定义 RSS'}
        </button>
      </header>

      {notice && <p className={`inline-notice ${notice.type}`} aria-live="polite">{notice.text}</p>}

      {customOpen && (
        <form className="source-editor" onSubmit={addCustom}>
          <label>来源名称<input value={customDraft.name} onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })} /></label>
          <label className="source-url-field">RSS 地址<input value={customDraft.url} onChange={(event) => setCustomDraft({ ...customDraft, url: event.target.value })} required /></label>
          <label>题材<select value={customDraft.category} onChange={(event) => setCustomDraft({ ...customDraft, category: event.target.value })}>{intelligenceCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>语言<select value={customDraft.language} onChange={(event) => setCustomDraft({ ...customDraft, language: event.target.value as IntelligenceSource['language'] })}><option value="ALL">全部</option><option value="ZH">中文</option><option value="EN">英文</option></select></label>
          <button className="button primary" type="submit" disabled={busyId === 'custom'}>{busyId === 'custom' ? '添加中' : '添加来源'}</button>
        </form>
      )}

      <section className="source-catalog">
        <header><h2>来源目录</h2><button className="button primary" type="button" disabled={!selectedUrls.length || busyId === 'catalog'} onClick={() => void addSelected()}><Plus size={16} />添加所选</button></header>
        <div className="automatic-source-groups">
          {automaticSourceGroups.map((group) => (
            <section className="automatic-source-group" key={group.id}>
              <h3>{group.label}<span>{group.sources.length}</span></h3>
              <div>{group.sources.map((preset) => {
                const connected = existingUrls.has(preset.url);
                return (
                  <label className={connected ? 'connected' : ''} key={preset.url}>
                    <input type="checkbox" checked={connected || selectedUrls.includes(preset.url)} disabled={connected} onChange={() => togglePreset(preset.url)} />
                    <span><b>{preset.name}</b><small>{preset.category} / {preset.language === 'ZH' ? '中文' : '英文'}</small></span>
                    <em>{connected ? '已接入' : '可添加'}</em>
                  </label>
                );
              })}</div>
            </section>
          ))}
        </div>
      </section>

      <section className="connected-sources">
        <header><h2>已接入来源</h2><span>{sources.length}</span></header>
        {sources.length === 0 ? <div className="source-empty">尚未接入资讯来源</div> : (
          <div className="source-rows">{sources.map((source) => (
            <article className="source-row" key={source.id}>
              {editingId === source.id ? (
                <div className="source-editor source-editor-inline">
                  <label>来源名称<input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} /></label>
                  <label className="source-url-field">RSS 地址<input value={editDraft.url} onChange={(event) => setEditDraft({ ...editDraft, url: event.target.value })} /></label>
                  <label>题材<select value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}>{intelligenceCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>刷新<select value={editDraft.refreshMinutes} onChange={(event) => setEditDraft({ ...editDraft, refreshMinutes: Number(event.target.value) })}>{[15, 30, 60, 180, 360, 720, 1440].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}</option>)}</select></label>
                  <label>包含词<input value={joinKeywords(editDraft.includeKeywords ?? [])} onChange={(event) => setEditDraft({ ...editDraft, includeKeywords: splitKeywords(event.target.value) })} /></label>
                  <label>排除词<input value={joinKeywords(editDraft.excludeKeywords ?? [])} onChange={(event) => setEditDraft({ ...editDraft, excludeKeywords: splitKeywords(event.target.value) })} /></label>
                  <div className="source-editor-actions"><button className="button" type="button" onClick={() => setEditingId(null)}>取消</button><button className="button primary" type="button" disabled={busyId === source.id} onClick={() => void saveEdit()}><Save size={16} />保存</button></div>
                </div>
              ) : (
                <>
                  <button className={`source-toggle ${source.enabled ? 'enabled' : ''}`} type="button" role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? '停用' : '启用'} ${source.name}`} disabled={busyId === source.id} onClick={() => void toggleEnabled(source)}><span /></button>
                  <div className="source-row-copy"><b>{source.name}</b><small>{source.category} / 每 {source.refreshMinutes} 分钟 / {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未刷新'}</small>{source.lastError && <em>{source.lastError}</em>}</div>
                  <div className="source-row-actions"><button className="icon-button" type="button" aria-label={`编辑 ${source.name}`} onClick={() => startEdit(source)}><Pencil size={16} /></button><button className="icon-button danger" type="button" aria-label={`删除 ${source.name}`} disabled={busyId === source.id} onClick={() => void remove(source)}><Trash2 size={16} /></button></div>
                </>
              )}
            </article>
          ))}</div>
        )}
      </section>
    </div>
  );
}
