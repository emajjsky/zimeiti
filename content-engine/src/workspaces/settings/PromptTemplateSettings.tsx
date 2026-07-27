import { FilePenLine, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webModels, type PromptTemplate, type PromptTemplateScope } from '../../data/webApi';

const templateTabs: { scope: PromptTemplateScope; label: string }[] = [
  { scope: 'INTELLIGENCE_ANALYSIS', label: '热点分析' },
  { scope: 'CREATIVE_OUTLINE', label: '生成大纲' },
  { scope: 'CREATIVE_DRAFT', label: '生成初稿' },
];

const analysisVariables = ['{{title}}', '{{summary}}', '{{source}}', '{{publishedAt}}', '{{category}}', '{{keywords}}', '{{primaryTopics}}', '{{accountPositioning}}', '{{targetAudience}}', '{{platforms}}'];

export function PromptTemplateSettings() {
  const [scope, setScope] = useState<PromptTemplateScope>('INTELLIGENCE_ANALYSIS');
  const [templates, setTemplates] = useState<Partial<Record<PromptTemplateScope, PromptTemplate>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<PromptTemplateScope, string>>>({});
  const [loadingScope, setLoadingScope] = useState<PromptTemplateScope | null>('INTELLIGENCE_ANALYSIS');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'resetting'>('idle');
  const [notice, setNotice] = useState<{ scope: PromptTemplateScope; type: 'success' | 'error'; text: string } | null>(null);

  const template = templates[scope] ?? null;
  const body = drafts[scope] ?? '';
  const dirty = Boolean(template && body !== template.body);
  const variables = useMemo(() => scope === 'INTELLIGENCE_ANALYSIS' ? analysisVariables : [], [scope]);

  useEffect(() => {
    if (templates[scope]) return;
    let cancelled = false;
    setLoadingScope(scope);
    setNotice(null);
    void webModels.promptTemplate(scope).then((result) => {
      if (cancelled) return;
      setTemplates((current) => ({ ...current, [scope]: result }));
      setDrafts((current) => ({ ...current, [scope]: result.body }));
    }).catch((error) => {
      if (!cancelled) setNotice({ scope, type: 'error', text: error instanceof Error ? error.message : '读取提示词模板失败。' });
    }).finally(() => {
      if (!cancelled) setLoadingScope(null);
    });
    return () => { cancelled = true; };
  }, [scope, templates]);

  const changeScope = (nextScope: PromptTemplateScope) => {
    if (busy !== 'idle') return;
    setScope(nextScope);
    setNotice(null);
  };

  const save = async () => {
    if (!template || !dirty) return;
    setBusy('saving'); setNotice(null);
    try {
      const result = await webModels.savePromptTemplate(scope, body);
      setTemplates((current) => ({ ...current, [scope]: result }));
      setDrafts((current) => ({ ...current, [scope]: result.body }));
      setNotice({ scope, type: 'success', text: '已保存新版本。' });
    } catch (error) { setNotice({ scope, type: 'error', text: error instanceof Error ? error.message : '保存提示词失败。' }); }
    finally { setBusy('idle'); }
  };

  const reset = async () => {
    if (!template) return;
    setBusy('resetting'); setNotice(null);
    try {
      const result = await webModels.resetPromptTemplate(scope);
      setTemplates((current) => ({ ...current, [scope]: result }));
      setDrafts((current) => ({ ...current, [scope]: result.body }));
      setNotice({ scope, type: 'success', text: '已恢复默认版本。' });
    } catch (error) { setNotice({ scope, type: 'error', text: error instanceof Error ? error.message : '恢复默认失败。' }); }
    finally { setBusy('idle'); }
  };

  return <section className="prompt-template-settings">
    <nav className="prompt-template-tabs" aria-label="提示词模板">
      {templateTabs.map((item) => <button type="button" key={item.scope} className={scope === item.scope ? 'active' : ''} onClick={() => changeScope(item.scope)}>{item.label}</button>)}
    </nav>
    <header className="prompt-template-head"><div><FilePenLine size={19}/><b>{templateTabs.find((item) => item.scope === scope)?.label}</b></div>{template && <small>V{template.version} · {template.source === 'DEFAULT' ? '默认' : '自定义'}{dirty ? ' · 未保存' : ''}</small>}</header>
    {notice?.scope === scope && <p className={`model-notice ${notice.type}`}>{notice.text}</p>}
    {loadingScope === scope ? <div className="prompt-template-loading"><LoaderCircle size={19}/><span>读取模板</span></div> : <>
      <textarea aria-label={`${templateTabs.find((item) => item.scope === scope)?.label}提示词`} value={body} onChange={(event) => setDrafts((current) => ({ ...current, [scope]: event.target.value }))} disabled={busy !== 'idle' || !template} />
      {variables.length > 0 && <div className="prompt-template-variables" aria-label="可用变量">{variables.map((value) => <button type="button" key={value} onClick={() => setDrafts((current) => ({ ...current, [scope]: `${current[scope] ?? ''}${current[scope] ? '\n' : ''}${value}` }))} disabled={busy !== 'idle' || !template}>{value}</button>)}</div>}
      <footer><button className="button" type="button" onClick={() => void reset()} disabled={busy !== 'idle' || !template}><RotateCcw size={16}/>{busy === 'resetting' ? '恢复中' : '恢复默认'}</button><button className="button primary" type="button" onClick={() => void save()} disabled={busy !== 'idle' || !template || !dirty}><Save size={16}/>{busy === 'saving' ? '保存中' : '保存新版本'}</button></footer>
    </>}
  </section>;
}
