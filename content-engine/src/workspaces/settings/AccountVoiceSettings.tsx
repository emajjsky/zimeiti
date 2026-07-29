import { Check, ChevronLeft, CircleAlert, PenLine, Plus, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { webAccountVoices } from '../../data/webApi';
import type { AccountVoiceInput, AccountVoiceProfile, AccountVoiceRules } from '../../domain/creative';

type Archetype = {
  slug: string;
  name: string;
  summary: string;
  do: string;
  avoid: string;
  opening: string;
  reasoning: string;
  rhythm: string;
  ending: string;
};

const archetypes: Archetype[] = [
  { slug: 'say-it-through', name: '把话说透', summary: '结论先行，把理由和边界交代清楚。', do: '先给判断，再拆理由', avoid: '绕圈铺垫', opening: '从明确判断、已核验事实或具体观察进入。', reasoning: '先说结论，再解释理由、证据与边界。', rhythm: '短中句交替，一段只推进一个判断。', ending: '自然收束到仍待解决的问题或可执行判断。' },
  { slug: 'field-notes', name: '一线手记', summary: '从真实细节和可验证的观察开始。', do: '让观察推动判断', avoid: '虚构亲历', opening: '从真实场景、细节或明确观察进入。', reasoning: '让观察、事实和判断分层推进。', rhythm: '细节与判断交替，保留停顿感。', ending: '回到开篇观察，留下克制余味。' },
  { slug: 'calm-commentary', name: '冷静评论', summary: '把事实、判断、推理分开来写。', do: '标明不确定性', avoid: '情绪替代证据', opening: '先交代关键事实或问题，再给可检验的判断。', reasoning: '事实、判断、推理分别陈述，并标明边界。', rhythm: '结构紧凑，少用修辞性重复。', ending: '保留反例或未确定部分。' },
  { slug: 'talk-to-a-friend', name: '讲给熟人听', summary: '说人话，但不卖弄熟络。', do: '把复杂问题讲明白', avoid: '强制互动', opening: '直接说明这件事为何值得读。', reasoning: '用日常语言解释概念，必要时给贴切例子。', rhythm: '自然、偏短，但不碎片化。', ending: '像一次谈话自然结束。' },
  { slug: 'slow-narrative', name: '慢叙述', summary: '人物、细节、时间线共同推进。', do: '让信息在叙述里出现', avoid: '百科式开头', opening: '从有依据的细节、人物或时间节点进入。', reasoning: '顺着时间、人物或因果推进，不把资料硬塞成提纲。', rhythm: '长短句配合，给关键细节留白。', ending: '落回具体细节或未封死的判断。' },
  { slug: 'hardcore-breakdown', name: '硬核拆解', summary: '结论与适用边界清晰，机制拆得明白。', do: '讲清前提和机制', avoid: '省略限制条件', opening: '先交代结论、边界和必要前提。', reasoning: '按机制、证据、限制条件拆解。', rhythm: '信息密度高，但段落清晰，术语首次出现即解释。', ending: '回到可验证结论与适用范围。' },
];

type FormState = AccountVoiceInput & { editedRules: AccountVoiceRules };

function rulesFor(archetype: Archetype, identityText: string, audienceText: string, readerTakeawayText: string): AccountVoiceRules {
  return {
    opening: archetype.opening,
    reasoning: archetype.reasoning,
    rhythm: archetype.rhythm,
    ending: archetype.ending,
    identityBoundary: `以“${identityText || '我的真实视角'}”表达；只写可验证或用户提供的经历，不虚构身份与亲历。`,
    audience: audienceText,
    readerTakeaway: readerTakeawayText,
    allowedPhrases: [],
    bannedPhrases: ['很多人会问', '今天我们就来', '简单来说', '这意味着', '建议点赞收藏', '评论区聊聊'],
    bannedStructures: ['emoji 小标题', '百科式定义开场', '强制互动结尾'],
  };
}

function formFrom(voice?: AccountVoiceProfile): FormState {
  const archetype = archetypes.find((item) => item.slug === voice?.archetypeSlug) ?? archetypes[0];
  const identityText = voice?.identityText ?? '';
  const audienceText = voice?.audienceText ?? '';
  const readerTakeawayText = voice?.readerTakeawayText ?? '';
  return {
    name: voice?.name ?? '', archetypeSlug: archetype.slug, identityText, audienceText, readerTakeawayText,
    editedRules: voice?.rules ?? rulesFor(archetype, identityText, audienceText, readerTakeawayText),
  };
}

export function AccountVoiceSettings() {
  const [voices, setVoices] = useState<AccountVoiceProfile[]>([]);
  const [screen, setScreen] = useState<'list' | 'editor'>('list');
  const [step, setStep] = useState(1);
  const [editing, setEditing] = useState<AccountVoiceProfile | null>(null);
  const [form, setForm] = useState<FormState>(() => formFrom());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibration, setCalibration] = useState({ title: '', sourceUrl: '', ruleSummary: '', confirmedLicensed: false });

  const selectedArchetype = useMemo(() => archetypes.find((item) => item.slug === form.archetypeSlug) ?? archetypes[0], [form.archetypeSlug]);
  const refresh = async () => {
    setLoading(true);
    try { setVoices((await webAccountVoices.list()).voices); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '账号声音加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const updateForm = (patch: Partial<FormState>) => {
    const next = { ...form, ...patch };
    const selected = archetypes.find((item) => item.slug === next.archetypeSlug) ?? archetypes[0];
    if (!editing || patch.archetypeSlug || patch.identityText !== undefined || patch.audienceText !== undefined || patch.readerTakeawayText !== undefined) {
      next.editedRules = rulesFor(selected, next.identityText, next.audienceText, next.readerTakeawayText);
    }
    setForm(next);
  };
  const begin = (voice?: AccountVoiceProfile) => { setEditing(voice ?? null); setForm(formFrom(voice)); setStep(voice ? 3 : 1); setError(''); setScreen('editor'); };
  const save = async () => {
    if (!form.name.trim() || !form.identityText.trim() || !form.audienceText.trim() || !form.readerTakeawayText.trim()) { setError('请补全名称和三句设定。'); return; }
    setSaving(true); setError('');
    try {
      const payload: AccountVoiceInput = { ...form, name: form.name.trim() };
      if (editing) await webAccountVoices.update(editing.id, payload); else await webAccountVoices.create(payload);
      await refresh(); setScreen('list'); setEditing(null); setCalibrationOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  };
  const makeDefault = async (voice: AccountVoiceProfile) => {
    setSaving(true); setError('');
    try { await webAccountVoices.makeDefault(voice.id); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '设置默认失败，请重试。'); }
    finally { setSaving(false); }
  };
  const saveCalibration = async () => {
    if (!editing || !calibration.title.trim() || !calibration.sourceUrl.trim()) { setError('请填写链接和标题。'); return; }
    setSaving(true); setError('');
    try {
      await webAccountVoices.addCalibration(editing.id, { sourceType: 'LINK', title: calibration.title.trim(), sourceUrl: calibration.sourceUrl.trim(), ruleSummary: calibration.ruleSummary.trim(), confirmedLicensed: calibration.confirmedLicensed });
      setCalibrationOpen(false); setCalibration({ title: '', sourceUrl: '', ruleSummary: '', confirmedLicensed: false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '校准材料保存失败。'); }
    finally { setSaving(false); }
  };

  if (screen === 'editor') return <section className="account-voice-settings">
    <header className="settings-section-header"><div><button type="button" className="text-button" onClick={() => setScreen('list')}><ChevronLeft size={16}/>账号声音</button><h1>{editing ? '编辑账号声音' : '创建账号声音'}</h1></div><span className="voice-step">第 {step} / 3 步</span></header>
    {error && <p className="voice-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    {step === 1 && <section className="voice-editor"><div className="voice-section-title"><span>01</span><div><h2>选一个表达原型</h2><p>不是套模板，它只决定你从哪里开始组织表达。</p></div></div><div className="voice-archetype-grid">{archetypes.map((item) => <button type="button" key={item.slug} className={form.archetypeSlug === item.slug ? 'voice-archetype selected' : 'voice-archetype'} onClick={() => updateForm({ archetypeSlug: item.slug })}><b>{item.name}</b><span>{item.summary}</span><small>这样写：{item.do}</small><small>避免：{item.avoid}</small></button>)}</div><footer><button className="button primary" type="button" onClick={() => setStep(2)}>下一步</button></footer></section>}
    {step === 2 && <section className="voice-editor voice-sentences"><div className="voice-section-title"><span>02</span><div><h2>用三句话交代“谁在说话”</h2><p>创作时会自动继承；每篇不需要重新填写。</p></div></div><label><span>声音名称</span><input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder="例如：我的财经观察" /></label><label><span>我是 / 以什么视角写</span><textarea value={form.identityText} onChange={(event) => updateForm({ identityText: event.target.value })} placeholder="例如：一个长期跟踪消费和公司的人，愿意把复杂问题讲明白。" /></label><label><span>写给谁</span><textarea value={form.audienceText} onChange={(event) => updateForm({ audienceText: event.target.value })} placeholder="例如：需要自己做判断、但不想被术语淹没的人。" /></label><label><span>读完希望留下什么</span><textarea value={form.readerTakeawayText} onChange={(event) => updateForm({ readerTakeawayText: event.target.value })} placeholder="例如：知道该看哪些证据，也知道结论在哪些条件下不成立。" /></label><footer><button className="text-button" type="button" onClick={() => setStep(1)}>上一步</button><button className="button primary" type="button" onClick={() => setStep(3)}>查看规则</button></footer></section>}
    {step === 3 && <section className="voice-editor voice-rules"><div className="voice-section-title"><span>03</span><div><h2>确认这套写作规则</h2><p>它会和题材、内容类型、渠道规则一起参与生成。</p></div></div><div className="voice-rule-fields">{(['opening', 'reasoning', 'rhythm', 'ending'] as const).map((key) => <label key={key}><span>{{ opening: '开篇', reasoning: '展开', rhythm: '节奏', ending: '收束' }[key]}</span><textarea value={form.editedRules[key]} onChange={(event) => setForm({ ...form, editedRules: { ...form.editedRules, [key]: event.target.value } })}/></label>)}</div><div className="voice-rules-boundary"><b>表达边界</b><p>{form.editedRules.identityBoundary}</p><span>自动避开：{form.editedRules.bannedPhrases.join('、')}</span></div><footer><button className="text-button" type="button" onClick={() => setStep(2)}>上一步</button><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? '保存中' : '保存账号声音'}</button></footer>{editing && <section className="voice-calibration"><button className="text-button" type="button" onClick={() => setCalibrationOpen((value) => !value)}>代表作校准（可选）</button>{calibrationOpen && <div className="voice-calibration-form"><label><span>链接</span><input value={calibration.sourceUrl} onChange={(event) => setCalibration({ ...calibration, sourceUrl: event.target.value })} placeholder="仅填写你拥有或获授权的内容链接" /></label><label><span>标题</span><input value={calibration.title} onChange={(event) => setCalibration({ ...calibration, title: event.target.value })} /></label><label><span>希望保留的表达特点</span><textarea value={calibration.ruleSummary} onChange={(event) => setCalibration({ ...calibration, ruleSummary: event.target.value })}/></label><label className="voice-license"><input type="checkbox" checked={calibration.confirmedLicensed} onChange={(event) => setCalibration({ ...calibration, confirmedLicensed: event.target.checked })}/><span>我确认对此材料拥有使用权或已获授权。</span></label><button className="button" type="button" disabled={saving} onClick={() => void saveCalibration()}>保存校准说明</button></div>}</section>}</section>}
  </section>;

  return <section className="account-voice-settings">
    <header className="settings-section-header"><div><h1>账号声音</h1><p>一次设定，创作项目自动继承。</p></div>{voices.length > 0 && <button className="button primary" type="button" onClick={() => begin()}><Plus size={16}/>创建账号声音</button>}</header>
    {error && <p className="voice-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    {loading ? <div className="voice-loading" aria-label="正在加载账号声音"><i/><i/></div> : voices.length === 0 ? <section className="settings-empty-state voice-empty"><Sparkles size={22}/><h2>先建立你的表达资产</h2><p>选一个原型，用三句话把自己说清楚，之后每篇内容都会自动带上它。</p><button className="button primary" type="button" onClick={() => begin()}>创建账号声音</button></section> : <div className="voice-profile-grid">{voices.map((voice) => <article key={voice.id} className="voice-profile-card"><header><span>{archetypes.find((item) => item.slug === voice.archetypeSlug)?.name ?? '账号声音'}</span>{voice.isDefault && <em><Check size={13}/>当前默认</em>}</header><h2>{voice.name}</h2><p>{voice.identityText}</p><div className="voice-card-meta"><span>V{voice.version}</span><span>{voice.audienceText}</span></div><footer><button className="text-button" type="button" onClick={() => begin(voice)}><PenLine size={15}/>编辑</button>{!voice.isDefault && <button className="text-button" type="button" disabled={saving} onClick={() => void makeDefault(voice)}>设为默认</button>}</footer></article>)}</div>}
  </section>;
}
