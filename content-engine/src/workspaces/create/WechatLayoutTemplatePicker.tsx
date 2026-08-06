import { Check, Copy, FilePlus2, Link2, LoaderCircle, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { WechatLayoutPreview, WechatLayoutTemplate } from '../../domain/content-drafts';

export type TemplateNotice = { tone: 'neutral' | 'success' | 'error'; message: string } | null;

function previewSrcDoc(html: string) {
  return `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;-ms-overflow-style:none;scrollbar-width:none;background:#fff;}body::-webkit-scrollbar{display:none}</style></head><body>${html}</body></html>`;
}

export function WechatLayoutTemplatePicker({
  templates,
  previews,
  selectedTemplateId,
  busyTemplateId,
  notice,
  onSelect,
  onImport,
  onDuplicate,
  onRemove,
}: {
  templates: WechatLayoutTemplate[];
  previews: Record<string, WechatLayoutPreview | undefined>;
  selectedTemplateId: string | null;
  busyTemplateId: string | null;
  notice: TemplateNotice;
  onSelect: (template: WechatLayoutTemplate) => void;
  onImport: (input: { name: string; url: string }) => Promise<void>;
  onDuplicate: (template: WechatLayoutTemplate) => Promise<void>;
  onRemove: (template: WechatLayoutTemplate) => Promise<void>;
}) {
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const submitImport = async () => {
    try {
      await onImport({ name: importName.trim(), url: importUrl.trim() });
      setImportName('');
      setImportUrl('');
      setConfirmedRights(false);
      setShowImport(false);
    } catch { /* 父组件保留明确的服务端错误状态。 */ }
  };

  return <aside className="wechat-template-picker" aria-label="公众号排版模板">
    <header className="wechat-template-picker-head">
      <div><h3>排版模板</h3><span>{templates.length} 个可用模板</span></div>
      <button className="button" type="button" onClick={() => setShowImport((value) => !value)}><Link2 size={15}/>导入公众号模板</button>
    </header>

    {showImport && <form className="wechat-template-import" onSubmit={(event) => { event.preventDefault(); void submitImport(); }}>
      <label><span>模板名称</span><input value={importName} maxLength={80} onChange={(event) => setImportName(event.target.value)} placeholder="例如：品牌深度稿"/></label>
      <label><span>公众号文章链接</span><input type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://mp.weixin.qq.com/s?..."/></label>
      <label className="wechat-template-rights"><input type="checkbox" checked={confirmedRights} onChange={(event) => setConfirmedRights(event.target.checked)}/><span>我确认有权参考该文章的排版</span></label>
      <footer>
        <button className="text-button" type="button" onClick={() => setShowImport(false)}>取消</button>
        <button className="button primary" type="submit" disabled={!importName.trim() || !importUrl.trim() || !confirmedRights || busyTemplateId === 'import'}>{busyTemplateId === 'import' ? <LoaderCircle size={15}/> : <FilePlus2 size={15}/>}分析并保存</button>
      </footer>
    </form>}

    {notice && <div className={`wechat-template-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

    <div className="wechat-template-grid">
      {templates.map((template) => {
        const selected = selectedTemplateId === template.id;
        const preview = previews[template.id];
        const deleting = deleteTargetId === template.id;
        return <article className={`wechat-template-card ${selected ? 'selected' : ''}`} key={template.id}>
          <button className="wechat-template-select" type="button" onClick={() => onSelect(template)} aria-pressed={selected}>
            <span className="wechat-template-mini-preview">
              {preview ? <iframe title={`${template.name}预览`} sandbox="" srcDoc={previewSrcDoc(preview.html)}/> : <span>{busyTemplateId === template.id ? <LoaderCircle size={17}/> : '等待预览'}</span>}
            </span>
            <span className="wechat-template-card-copy"><b>{template.name}</b><small>{template.kind === 'SYSTEM' ? '系统模板' : '自定义模板'} · V{template.currentVersionNumber}</small></span>
            {selected && <Check size={16} aria-hidden="true"/>}
          </button>
          <footer>
            <button className="icon-button" type="button" title="复制模板" aria-label={`复制模板：${template.name}`} disabled={busyTemplateId !== null} onClick={() => void onDuplicate(template)}><Copy size={14}/></button>
            {template.kind === 'CUSTOM' && (deleting ? <>
              <button className="icon-button danger-text" type="button" title="确认删除" aria-label={`确认删除模板：${template.name}`} disabled={busyTemplateId !== null} onClick={() => { setDeleteTargetId(null); void onRemove(template); }}><Check size={14}/></button>
              <button className="icon-button" type="button" title="取消删除" aria-label="取消删除" onClick={() => setDeleteTargetId(null)}><X size={14}/></button>
            </> : <button className="icon-button danger-icon" type="button" title="删除模板" aria-label={`删除模板：${template.name}`} disabled={busyTemplateId !== null} onClick={() => setDeleteTargetId(template.id)}><Trash2 size={14}/></button>)}
          </footer>
        </article>;
      })}
    </div>
  </aside>;
}
