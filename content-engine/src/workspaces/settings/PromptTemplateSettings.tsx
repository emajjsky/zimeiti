import { FilePenLine, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webModels, type PromptTemplate, type PromptTemplateScope } from '../../data/webApi';

type PromptTask = 'ANALYSIS' | 'VERIFICATION' | 'OUTLINE' | 'DRAFT' | 'REVISION';
type PromptPlatform = 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO';

const taskTabs: { id: PromptTask; label: string }[] = [
  { id: 'ANALYSIS', label: '热点分析' },
  { id: 'VERIFICATION', label: '事实核验' },
  { id: 'OUTLINE', label: '生成大纲' },
  { id: 'DRAFT', label: '生成初稿' },
  { id: 'REVISION', label: '修改文案' },
];

const platforms: { id: PromptPlatform; label: string }[] = [
  { id: 'WECHAT', label: '公众号图文' },
  { id: 'XIAOHONGSHU', label: '小红书图文' },
  { id: 'ZHIHU', label: '知乎回答' },
  { id: 'WEIBO', label: '微博内容' },
];

const analysisVariables = ['{{title}}', '{{summary}}', '{{source}}', '{{publishedAt}}', '{{category}}', '{{keywords}}', '{{primaryTopics}}', '{{accountPositioning}}', '{{targetAudience}}', '{{platforms}}'];

function scopeFor(task: PromptTask, platform: PromptPlatform): PromptTemplateScope {
  if (task === 'ANALYSIS') return 'INTELLIGENCE_ANALYSIS';
  if (task === 'VERIFICATION') return 'SOURCE_VERIFICATION';
  return `CREATIVE_${task}_${platform}` as PromptTemplateScope;
}

export function PromptTemplateSettings() {
  const [task, setTask] = useState<PromptTask>('ANALYSIS');
  const [platform, setPlatform] = useState<PromptPlatform>('WECHAT');
  const scope = scopeFor(task, platform);
  const [templates, setTemplates] = useState<Partial<Record<PromptTemplateScope, PromptTemplate>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<PromptTemplateScope, string>>>({});
  const [loadingScope, setLoadingScope] = useState<PromptTemplateScope | null>('INTELLIGENCE_ANALYSIS');
  const [busy, setBusy] = useState<'idle' | 'saving' | 'resetting'>('idle');
  const [notice, setNotice] = useState<{ scope: PromptTemplateScope; type: 'success' | 'error'; text: string } | null>(null);

  const template = templates[scope] ?? null;
  const body = drafts[scope] ?? '';
  const dirty = Boolean(template && body !== template.body);
  const taskLabel = taskTabs.find((item) => item.id === task)?.label ?? '';
  const platformLabel = platforms.find((item) => item.id === platform)?.label ?? '';
  const editorTitle = ['ANALYSIS', 'VERIFICATION'].includes(task) ? taskLabel : `${taskLabel} · ${platformLabel}`;
  const variables = useMemo(() => task === 'ANALYSIS' ? analysisVariables : [], [task]);

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

  const changeTask = (nextTask: PromptTask) => {
    if (busy !== 'idle') return;
    setTask(nextTask);
    setNotice(null);
  };

  const changePlatform = (nextPlatform: PromptPlatform) => {
    if (busy !== 'idle') return;
    setPlatform(nextPlatform);
    setNotice(null);
  };

  const save = async () => {
    if (!template || !dirty) return;
    setBusy('saving');
    setNotice(null);
    try {
      const result = await webModels.savePromptTemplate(scope, body);
      setTemplates((current) => ({ ...current, [scope]: result }));
      setDrafts((current) => ({ ...current, [scope]: result.body }));
      setNotice({ scope, type: 'success', text: '已保存新版本。' });
    } catch (error) {
      setNotice({ scope, type: 'error', text: error instanceof Error ? error.message : '保存提示词失败。' });
    } finally {
      setBusy('idle');
    }
  };

  const reset = async () => {
    if (!template) return;
    setBusy('resetting');
    setNotice(null);
    try {
      const result = await webModels.resetPromptTemplate(scope);
      setTemplates((current) => ({ ...current, [scope]: result }));
      setDrafts((current) => ({ ...current, [scope]: result.body }));
      setNotice({ scope, type: 'success', text: '已恢复默认版本。' });
    } catch (error) {
      setNotice({ scope, type: 'error', text: error instanceof Error ? error.message : '恢复默认失败。' });
    } finally {
      setBusy('idle');
    }
  };

  return <section className="prompt-template-settings">
    <nav className="prompt-template-tabs" aria-label="提示词任务">
      {taskTabs.map((item) => <button type="button" key={item.id} className={task === item.id ? 'active' : ''} onClick={() => changeTask(item.id)}>{item.label}</button>)}
    </nav>
    {!['ANALYSIS', 'VERIFICATION'].includes(task) && <nav className="prompt-platform-tabs" aria-label="目标平台">
      {platforms.map((item) => <button type="button" key={item.id} className={platform === item.id ? 'active' : ''} onClick={() => changePlatform(item.id)}>{item.label}</button>)}
    </nav>}
    <header className="prompt-template-head"><div><FilePenLine size={19}/><b>{editorTitle}</b></div>{template && <small>V{template.version} · {template.source === 'DEFAULT' ? '默认' : '自定义'}{dirty ? ' · 未保存' : ''}</small>}</header>
    {notice?.scope === scope && <p className={`model-notice ${notice.type}`}>{notice.text}</p>}
    {loadingScope === scope ? <div className="prompt-template-loading"><LoaderCircle size={19}/><span>读取模板</span></div> : <>
      <textarea aria-label={`${editorTitle}提示词`} value={body} onChange={(event) => setDrafts((current) => ({ ...current, [scope]: event.target.value }))} disabled={busy !== 'idle' || !template}/>
      {variables.length > 0 && <div className="prompt-template-variables" aria-label="可用变量">{variables.map((value) => <button type="button" key={value} onClick={() => setDrafts((current) => ({ ...current, [scope]: `${current[scope] ?? ''}${current[scope] ? '\n' : ''}${value}` }))} disabled={busy !== 'idle' || !template}>{value}</button>)}</div>}
      <footer><button className="button" type="button" onClick={() => void reset()} disabled={busy !== 'idle' || !template}><RotateCcw size={16}/>{busy === 'resetting' ? '恢复中' : '恢复默认'}</button><button className="button primary" type="button" onClick={() => void save()} disabled={busy !== 'idle' || !template || !dirty}><Save size={16}/>{busy === 'saving' ? '保存中' : '保存新版本'}</button></footer>
    </>}
  </section>;
}
