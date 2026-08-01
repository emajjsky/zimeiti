import { ChevronRight, Link2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '../../components/workspace/PageHeader';
import type { LocalState } from '../../data/localRepository';

type IntelligenceInput = Omit<LocalState['intelligence'][number], 'id'>;
type LinkPreview = { url: string; title: string; summary: string; source: string; category: string; keywords: string[] };

export function LinkImportPanel({
  onSave,
  onShowInbox,
  previewLink,
}: {
  onSave: (item: IntelligenceInput) => Promise<void>;
  onShowInbox: () => void;
  previewLink: (url: string) => Promise<LinkPreview>;
}) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const read = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await previewLink(url.trim());
      setUrl(result.url);
      setPreview(result);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : '读取链接失败。');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        title: preview.title,
        summary: preview.summary,
        source: preview.source || '导入链接',
        category: preview.category || '其它',
        keywords: preview.keywords,
        publishedAt: new Date().toISOString(),
        heat: 0,
        trust: '待核验',
        url: preview.url,
        note: note.trim(),
        captureMethod: 'MANUAL_LINK',
      });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存链接失败。');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setUrl('');
    setPreview(null);
    setNote('');
    setError('');
    setSaved(false);
  };

  return (
    <div className="link-import-panel">
      <PageHeader title="导入链接" />
      {saved ? (
        <section className="link-import-success" aria-live="polite">
          <h2>已加入热点池</h2>
          <div><button className="button" type="button" onClick={reset}>继续导入</button><button className="button primary" type="button" onClick={onShowInbox}>查看热点情报</button></div>
        </section>
      ) : (
        <>
          <div className="link-reader">
            <label>公开网页链接<div className="input-with-icon"><Link2 size={17} /><input value={url} onChange={(event) => { setUrl(event.target.value); setPreview(null); setError(''); }} autoFocus /></div></label>
            <button className="button primary" type="button" disabled={loading || !url.trim()} onClick={() => void read()}>{loading ? '读取中' : '读取链接'}</button>
          </div>
          {error && <p className="inline-notice error" aria-live="polite">{error}</p>}
          {loading ? <div className="link-preview-skeleton"><i /><i /><i /></div> : preview && (
            <section className="link-preview">
              <div className="link-preview-meta"><span>{preview.source}</span><span>{preview.category}</span></div>
              <h2>{preview.title}</h2>
              <p>{preview.summary}</p>
              <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <footer><a href={preview.url} target="_blank" rel="noreferrer">查看原文</a><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? '保存中' : '加入热点池'} <ChevronRight size={16} /></button></footer>
            </section>
          )}
        </>
      )}
    </div>
  );
}
