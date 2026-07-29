import { Check, ChevronLeft, CircleAlert, FileText, Link2, PenLine, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webAccountVoices } from '../../data/webApi';
import type { AccountVoiceCalibrationDraft, AccountVoiceInput, AccountVoiceProfile, AccountVoiceRules } from '../../domain/creative';

const manualRules: AccountVoiceRules = {
  opening: '从明确判断、真实观察或可验证事实进入。',
  reasoning: '先说清结论，再解释理由、证据和适用边界。',
  rhythm: '短中句交替；一段只推进一个意思。',
  ending: '自然收束到可执行判断或仍待解决的问题，不强制互动。',
  identityBoundary: '只写真实、可验证或用户提供的材料；不虚构身份、经历和立场。',
  audience: '普通读者。',
  readerTakeaway: '读完知道判断依据与适用边界。',
  allowedPhrases: [],
  bannedPhrases: ['很多人会问', '今天我们就来', '建议点赞收藏', '评论区聊聊'],
  bannedStructures: ['emoji 小标题', '百科式定义开场', '强制互动结尾'],
  hookPatterns: [],
  argumentPattern: '',
  evidenceStyle: '',
  paragraphPattern: '',
  languageTexture: '',
  readerRelationship: '',
  titlePatterns: [],
  closingStyle: '',
};

type FormState = AccountVoiceInput & { editedRules: AccountVoiceRules; ruleSummary?: string; analysis?: AccountVoiceCalibrationDraft['analysis'] };
type ImportedArticle = { title: string; url: string; source: string };

function formFrom(voice?: AccountVoiceProfile): FormState {
  return {
    name: voice?.name ?? '',
    archetypeSlug: voice?.archetypeSlug ?? 'say-it-through',
    identityText: voice?.identityText ?? manualRules.identityBoundary,
    audienceText: voice?.audienceText ?? manualRules.audience,
    readerTakeawayText: voice?.readerTakeawayText ?? manualRules.readerTakeaway,
    editedRules: { ...manualRules, ...(voice?.rules ?? {}) },
  };
}

export function AccountVoiceSettings() {
  const [voices, setVoices] = useState<AccountVoiceProfile[]>([]);
  const [screen, setScreen] = useState<'list' | 'import' | 'review'>('list');
  const [editing, setEditing] = useState<AccountVoiceProfile | null>(null);
  const [form, setForm] = useState<FormState>(() => formFrom());
  const [article, setArticle] = useState<ImportedArticle | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [confirmedLicensed, setConfirmedLicensed] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    try { setVoices((await webAccountVoices.list()).voices); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '账号声音加载失败。'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const returnToList = () => { setScreen('list'); setEditing(null); setArticle(null); setError(''); };
  const beginImport = () => {
    setEditing(null); setForm(formFrom()); setArticle(null); setSourceUrl(''); setConfirmedLicensed(false); setMakeDefault(true); setError(''); setScreen('import');
  };
  const beginManual = () => {
    setEditing(null); setForm(formFrom()); setArticle(null); setMakeDefault(true); setError(''); setScreen('review');
  };
  const beginEdit = (voice: AccountVoiceProfile) => {
    setEditing(voice); setForm(formFrom(voice)); setArticle(null); setMakeDefault(Boolean(voice.isDefault)); setError(''); setScreen('review');
  };
  const distill = async () => {
    if (!sourceUrl.trim()) { setError('请粘贴文章链接。'); return; }
    if (!confirmedLicensed) { setError('请先确认你拥有这篇文章的使用权或已获授权。'); return; }
    setSaving(true); setError('');
    try {
      const result = await webAccountVoices.createCalibrationDraft({ sourceUrl: sourceUrl.trim(), confirmedLicensed });
      const draft: AccountVoiceCalibrationDraft = result.draft;
      setForm({ ...draft }); setArticle(result.article); setScreen('review');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取或提炼失败，请重试。'); }
    finally { setSaving(false); }
  };
  const save = async () => {
    if (!form.name.trim()) { setError('给这套表达规则起个名称即可。'); return; }
    setSaving(true); setError('');
    try {
      const payload: AccountVoiceInput = { ...form, name: form.name.trim() };
      const result = editing
        ? await webAccountVoices.update(editing.id, payload)
        : await webAccountVoices.create(payload);
      const profile = result.voice;
      if (article && confirmedLicensed && !editing) {
        await webAccountVoices.addCalibration(profile.id, { sourceType: 'LINK', title: article.title, sourceUrl: article.url, ruleSummary: form.ruleSummary ?? '', confirmedLicensed: true });
      }
      if (makeDefault) await webAccountVoices.makeDefault(profile.id);
      await refresh(); returnToList();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  };
  const updateRule = (key: keyof Pick<AccountVoiceRules, 'opening' | 'reasoning' | 'rhythm' | 'ending'>, value: string) => {
    setForm((current) => ({ ...current, editedRules: { ...current.editedRules, [key]: value } }));
  };
  const setDefault = async (voice: AccountVoiceProfile) => {
    setSaving(true); setError('');
    try { await webAccountVoices.makeDefault(voice.id); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '设置默认失败，请重试。'); }
    finally { setSaving(false); }
  };

  if (screen === 'import') return <section className="account-voice-settings">
    <header className="settings-section-header"><div><button type="button" className="text-button" onClick={returnToList}><ChevronLeft size={16}/>账号声音</button><h1>导入我的文章</h1></div></header>
    {error && <p className="voice-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    <section className="voice-import-card">
      <Link2 size={22}/><div><h2>粘贴一篇你自己的公开文章</h2><p>支持公众号和可公开读取的自媒体文章链接。</p></div>
      <label><span>文章链接</span><input autoFocus value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://mp.weixin.qq.com/s/..." /></label>
      <label className="voice-license"><input type="checkbox" checked={confirmedLicensed} onChange={(event) => setConfirmedLicensed(event.target.checked)} /><span>我拥有这篇内容，或已获授权用于表达校准。</span></label>
      <footer><button className="button primary" type="button" disabled={saving} onClick={() => void distill()}>{saving ? '正在读取并提炼…' : '读取并提炼'}</button><button className="text-button" type="button" onClick={beginManual}>不用文章，手动设定</button></footer>
    </section>
  </section>;

  if (screen === 'review') return <section className="account-voice-settings">
    <header className="settings-section-header"><div><button type="button" className="text-button" onClick={returnToList}><ChevronLeft size={16}/>账号声音</button><h1>{editing ? '编辑表达规则' : '确认表达规则'}</h1></div></header>
    {error && <p className="voice-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    <section className="voice-review-card">
      {article && <div className="voice-source-chip"><FileText size={15}/><span>{article.source}</span><a href={article.url} target="_blank" rel="noreferrer">{article.title}</a></div>}
      <label className="voice-name-field"><span>名称</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：我的公众号表达" /></label>
      {form.ruleSummary && <p className="voice-rule-summary">{form.ruleSummary}</p>}
      {form.analysis && <section className="voice-diagnosis">
        <header><div><span>声音指纹</span><h2>{form.analysis.voiceFingerprint}</h2></div><em className={`voice-confidence ${form.analysis.confidence.toLowerCase()}`}>{form.analysis.confidence === 'LOW' ? '单篇样本' : form.analysis.confidence === 'MEDIUM' ? '多篇样本' : '稳定样本'}</em></header>
        <div className="voice-diagnosis-grid">{form.analysis.diagnostics.map((item) => <article key={item.dimension}><b>{item.dimension}</b><p>{item.finding}</p><small>{item.evidence}</small></article>)}</div>
      </section>}
      <details className="voice-execution-rules" open><summary>用于后续创作的执行规则</summary>
        <div className="voice-rule-fields compact">{(['opening', 'reasoning', 'rhythm', 'ending'] as const).map((key) => <label key={key}><span>{{ opening: '怎么开篇', reasoning: '怎么展开', rhythm: '文字节奏', ending: '怎么收束' }[key]}</span><textarea value={form.editedRules[key]} onChange={(event) => updateRule(key, event.target.value)} /></label>)}</div>
        <div className="voice-execution-grid"><article><b>钩子套路</b><span>{form.editedRules.hookPatterns.join('；') || '未提炼到稳定套路'}</span></article><article><b>论证方式</b><span>{form.editedRules.argumentPattern || '未提炼到稳定模式'}</span></article><article><b>证据习惯</b><span>{form.editedRules.evidenceStyle || '未提炼到稳定习惯'}</span></article><article><b>语言颗粒</b><span>{form.editedRules.languageTexture || '未提炼到稳定特征'}</span></article><article><b>标题套路</b><span>{form.editedRules.titlePatterns.join('；') || '未提炼到稳定套路'}</span></article><article><b>读者关系</b><span>{form.editedRules.readerRelationship || '未提炼到稳定关系'}</span></article></div>
      </details>
      <div className="voice-rule-boundary"><b>自动避开</b><span>{form.editedRules.bannedPhrases.join('、')}</span></div>
      <label className="voice-license"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} /><span>保存后设为默认账号声音</span></label>
      <footer><button className="text-button" type="button" onClick={article ? () => setScreen('import') : returnToList}>返回</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '确认并保存'}</button></footer>
    </section>
  </section>;

  return <section className="account-voice-settings">
    <header className="settings-section-header"><div><h1>账号声音</h1><p>创作项目会自动继承默认规则。</p></div>{voices.length > 0 && <button className="button primary" type="button" onClick={beginImport}><Plus size={16}/>导入我的文章</button>}</header>
    {error && <p className="voice-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    {loading ? <div className="voice-loading" aria-label="正在加载账号声音"><i/><i/></div> : voices.length === 0 ? <section className="settings-empty-state voice-empty"><Sparkles size={22}/><h2>让一篇自己的文章定义你的表达</h2><p>读取后只保存规则和链接，不保存文章全文。</p><div><button className="button primary" type="button" onClick={beginImport}>导入我的文章</button><button className="text-button" type="button" onClick={beginManual}>手动设定</button></div></section> : <div className="voice-profile-grid">{voices.map((voice) => <article key={voice.id} className="voice-profile-card"><header><span>账号表达</span>{voice.isDefault && <em><Check size={13}/>当前默认</em>}</header><h2>{voice.name}</h2><p>{voice.rules.opening}</p><div className="voice-card-meta"><span>V{voice.version}</span><span>{voice.rules.rhythm}</span></div><footer><button className="text-button" type="button" onClick={() => beginEdit(voice)}><PenLine size={15}/>编辑</button>{!voice.isDefault && <button className="text-button" type="button" disabled={saving} onClick={() => void setDefault(voice)}>设为默认</button>}</footer></article>)}</div>}
  </section>;
}
