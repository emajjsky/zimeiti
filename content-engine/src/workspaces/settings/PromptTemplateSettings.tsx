import { FilePenLine, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webModels, type PromptTemplate } from '../../data/webApi';

const variables = ['{{title}}', '{{summary}}', '{{source}}', '{{publishedAt}}', '{{category}}', '{{keywords}}', '{{primaryTopics}}', '{{accountPositioning}}', '{{targetAudience}}', '{{platforms}}'];

export function PromptTemplateSettings() {
  const [template, setTemplate] = useState<PromptTemplate | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'resetting'>('idle');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void webModels.promptTemplate().then((result) => { setTemplate(result); setBody(result.body); }).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取提示词模板失败。' }));
  }, []);

  const save = async () => {
    setBusy('saving'); setNotice(null);
    try {
      const result = await webModels.savePromptTemplate(body);
      setTemplate(result); setBody(result.body); setNotice({ type: 'success', text: '已保存新版本。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存提示词失败。' }); }
    finally { setBusy('idle'); }
  };

  const reset = async () => {
    setBusy('resetting'); setNotice(null);
    try {
      const result = await webModels.resetPromptTemplate();
      setTemplate(result); setBody(result.body); setNotice({ type: 'success', text: '已恢复默认版本。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '恢复默认失败。' }); }
    finally { setBusy('idle'); }
  };

  return <section className="prompt-template-settings">
    <header className="prompt-template-head"><div><FilePenLine size={19}/><b>热点分析</b></div>{template && <small>V{template.version} · {template.source === 'DEFAULT' ? '默认' : '自定义'}</small>}</header>
    {notice && <p className={`model-notice ${notice.type}`}>{notice.text}</p>}
    <textarea aria-label="热点分析提示词" value={body} onChange={(event) => setBody(event.target.value)} disabled={busy !== 'idle' || !template} />
    <div className="prompt-template-variables" aria-label="可用变量">{variables.map((value) => <button type="button" key={value} onClick={() => setBody((current) => `${current}${current ? '\n' : ''}${value}`)} disabled={busy !== 'idle' || !template}>{value}</button>)}</div>
    <footer><button className="button" type="button" onClick={() => void reset()} disabled={busy !== 'idle' || !template}><RotateCcw size={16}/>{busy === 'resetting' ? '恢复中' : '恢复默认'}</button><button className="button primary" type="button" onClick={() => void save()} disabled={busy !== 'idle' || !template}><Save size={16}/>{busy === 'saving' ? '保存中' : '保存'}</button></footer>
  </section>;
}
