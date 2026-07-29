const { z } = require('zod');

const VOICE_ARCHETYPES = [
  {
    slug: 'say-it-through',
    name: '把话说透',
    summary: '先给判断，再说理由和边界。',
    doRules: ['从明确判断、已核验事实或具体观察进入', '先说结论，再拆理由和限制条件'],
    avoidRules: ['假设读者提问', '绕圈铺垫', '用结论代替推理'],
    opening: '从明确判断、已核验事实或用户提供的具体观察进入，不用假设读者提问开场。',
    reasoning: '先给判断，再逐层说明理由、证据与边界。',
    rhythm: '短中句交替，一段只推进一个判断。',
    ending: '结尾自然收束到仍待解决的问题或可执行判断，不强制互动。',
  },
  {
    slug: 'field-notes',
    name: '一线手记',
    summary: '从亲历细节或明确观察进入。',
    doRules: ['从真实场景、细节或观察起笔', '让观察推动判断'],
    avoidRules: ['虚构亲历', '为煽情夸大细节'],
    opening: '从用户提供的真实场景、细节或明确观察进入；没有材料时不伪造亲历。',
    reasoning: '用观察、事实和判断分层推进。',
    rhythm: '句子有停顿感，细节和判断交替出现。',
    ending: '回到开篇观察，留下克制的余味。',
  },
  {
    slug: 'calm-commentary',
    name: '冷静评论',
    summary: '事实、判断、推理分开写。',
    doRules: ['区分事实、判断与推理', '明确不确定性'],
    avoidRules: ['口号', '替读者下结论', '情绪代替证据'],
    opening: '先交代关键事实或问题，再给出清晰但可检验的判断。',
    reasoning: '事实、判断、推理分别陈述，并标注边界。',
    rhythm: '结构紧凑，减少修辞性重复。',
    ending: '保留反例或未确定部分，不替读者做选择。',
  },
  {
    slug: 'talk-to-a-friend',
    name: '讲给熟人听',
    summary: '口语化，但不卖萌和不装熟。',
    doRules: ['用日常语言解释复杂问题', '直接说人话'],
    avoidRules: ['卖萌', 'emoji 标题', '强制互动'],
    opening: '直接交代这件事为何值得读，不用夸张钩子。',
    reasoning: '用日常语言解释概念，必要时给出贴切但不过度的例子。',
    rhythm: '句子自然、短一些，但不碎片化。',
    ending: '像一次谈话的自然结束，不索要点赞、收藏或评论。',
  },
  {
    slug: 'slow-narrative',
    name: '慢叙述',
    summary: '让人物、细节与时间线推进内容。',
    doRules: ['用人物、细节和时间线推进', '让信息在叙述里出现'],
    avoidRules: ['先下百科定义', '为了转折而制造戏剧性'],
    opening: '从一个有依据的细节、人物或时间节点进入。',
    reasoning: '按时间、人物或因果推进，不把资料硬塞成提纲。',
    rhythm: '长短句配合，为重要细节留白。',
    ending: '落回具体细节或一个尚未封死的判断。',
  },
  {
    slug: 'hardcore-breakdown',
    name: '硬核拆解',
    summary: '先讲结论与边界，再讲机制。',
    doRules: ['先给结论与适用边界', '解释机制和前提'],
    avoidRules: ['把常识包装成新知', '省略限制条件'],
    opening: '先说明结论、问题边界和读者需要知道的前提。',
    reasoning: '按机制、证据、限制条件拆解，不跳过关键推理。',
    rhythm: '信息密度高但段落清楚，术语首次出现即解释。',
    ending: '回到可验证的结论与适用范围。',
  },
];

const COMMON_BANNED_PHRASES = ['很多人会问', '今天我们就来', '今天带你', '简单来说', '这意味着', '建议点赞收藏', '评论区聊聊'];
const COMMON_BANNED_STRUCTURES = ['emoji 小标题', '百科式定义开场', '强制互动结尾'];
const VOICE_OFFSETS = ['DEFAULT', 'MORE_RESTRAINED', 'SHARPER', 'MORE_PERSONAL', 'MORE_NARRATIVE'];
const voiceArchetypeSlugs = VOICE_ARCHETYPES.map((item) => item.slug);

const voiceRulesSchema = z.object({
  opening: z.string().trim().min(1).max(1_000),
  reasoning: z.string().trim().min(1).max(1_000),
  rhythm: z.string().trim().min(1).max(1_000),
  ending: z.string().trim().min(1).max(1_000),
  identityBoundary: z.string().trim().min(1).max(1_000),
  audience: z.string().trim().min(1).max(600),
  readerTakeaway: z.string().trim().min(1).max(600),
  allowedPhrases: z.array(z.string().trim().min(1).max(100)).max(30),
  bannedPhrases: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  bannedStructures: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
});

const accountVoiceInput = z.object({
  name: z.string().trim().min(1).max(80),
  archetypeSlug: z.enum(voiceArchetypeSlugs),
  identityText: z.string().trim().min(1).max(600),
  audienceText: z.string().trim().min(1).max(600),
  readerTakeawayText: z.string().trim().min(1).max(600),
  editedRules: voiceRulesSchema.optional(),
});

const accountVoiceCalibrationInput = z.object({
  sourceType: z.enum(['LINK', 'FILE', 'TEXT']),
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().optional(),
  fileReference: z.string().trim().min(1).max(300).optional(),
  ruleSummary: z.string().trim().max(4_000).default(''),
  confirmedLicensed: z.boolean().refine((value) => value, '请完成表达参考使用权确认。'),
}).superRefine((value, context) => {
  if (value.sourceType === 'LINK' && !value.sourceUrl) context.addIssue({ code: 'custom', path: ['sourceUrl'], message: '请提供参考链接。' });
  if (value.sourceType === 'FILE' && !value.fileReference) context.addIssue({ code: 'custom', path: ['fileReference'], message: '请提供已上传的文件标识。' });
  if (value.sourceType !== 'LINK' && value.sourceUrl) context.addIssue({ code: 'custom', path: ['sourceUrl'], message: '该类型不能填写链接。' });
  if (value.sourceType !== 'FILE' && value.fileReference) context.addIssue({ code: 'custom', path: ['fileReference'], message: '该类型不能填写文件标识。' });
});

function buildInitialVoiceRules({ archetypeSlug, identityText, audienceText, readerTakeawayText }) {
  const archetype = VOICE_ARCHETYPES.find((item) => item.slug === archetypeSlug);
  if (!archetype) throw new Error('表达原型不存在，请重新选择。');
  return {
    opening: archetype.opening,
    reasoning: archetype.reasoning,
    rhythm: archetype.rhythm,
    ending: archetype.ending,
    identityBoundary: `作者身份与视角：${identityText}。只写用户提供或可核验的经历，不虚构身份、亲历或立场。`,
    audience: audienceText,
    readerTakeaway: readerTakeawayText,
    allowedPhrases: [],
    bannedPhrases: [...COMMON_BANNED_PHRASES],
    bannedStructures: [...COMMON_BANNED_STRUCTURES, ...archetype.avoidRules],
  };
}

function profileView(row, rules = row.rules_json ?? {}) {
  return {
    id: row.id,
    name: row.name,
    archetypeSlug: row.archetype_slug,
    identityText: row.identity_text,
    audienceText: row.audience_text,
    readerTakeawayText: row.reader_takeaway_text,
    status: row.status,
    version: Number(row.current_version),
    rules,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rulesFor(input) {
  return input.editedRules ?? buildInitialVoiceRules(input);
}

function createAccountVoiceStore({ query, transaction }) {
  async function get(workspaceId, profileId) {
    const result = await query(`SELECT p.*, v.rules_json
      FROM account_voice_profiles p
      JOIN account_voice_versions v ON v.profile_id = p.id AND v.version = p.current_version
      WHERE p.workspace_id = $1 AND p.id = $2`, [workspaceId, profileId]);
    return result.rows[0] ? profileView(result.rows[0]) : null;
  }

  async function list(workspaceId) {
    const result = await query(`SELECT p.*, v.rules_json, (d.profile_id = p.id) AS is_default
      FROM account_voice_profiles p
      JOIN account_voice_versions v ON v.profile_id = p.id AND v.version = p.current_version
      LEFT JOIN account_voice_defaults d ON d.workspace_id = p.workspace_id
      WHERE p.workspace_id = $1
      ORDER BY (d.profile_id = p.id) DESC, p.updated_at DESC`, [workspaceId]);
    return result.rows.map((row) => ({ ...profileView(row), isDefault: Boolean(row.is_default) }));
  }

  async function create(workspaceId, input) {
    const rules = rulesFor(input);
    return transaction(async (client) => {
      const profileResult = await client.query(`INSERT INTO account_voice_profiles
        (workspace_id, name, archetype_slug, identity_text, audience_text, reader_takeaway_text)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`, [workspaceId, input.name, input.archetypeSlug, input.identityText, input.audienceText, input.readerTakeawayText]);
      const profile = profileResult.rows[0];
      await client.query(`INSERT INTO account_voice_versions (profile_id, version, rules_json)
        VALUES ($1, 1, $2::jsonb)`, [profile.id, JSON.stringify(rules)]);
      return profileView(profile, rules);
    });
  }

  async function update(workspaceId, profileId, input) {
    const rules = rulesFor(input);
    return transaction(async (client) => {
      const existing = await client.query(`SELECT * FROM account_voice_profiles
        WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, profileId]);
      const profile = existing.rows[0];
      if (!profile) throw new Error('账号声音不存在或无权访问。');
      const nextVersion = Number(profile.current_version) + 1;
      const updated = await client.query(`UPDATE account_voice_profiles
        SET name = $3, archetype_slug = $4, identity_text = $5, audience_text = $6,
          reader_takeaway_text = $7, current_version = $8, updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, profileId, input.name, input.archetypeSlug, input.identityText, input.audienceText, input.readerTakeawayText, nextVersion]);
      await client.query(`INSERT INTO account_voice_versions (profile_id, version, rules_json)
        VALUES ($1, $2, $3::jsonb)`, [profileId, nextVersion, JSON.stringify(rules)]);
      return profileView(updated.rows[0] ?? {
        ...profile,
        name: input.name,
        archetype_slug: input.archetypeSlug,
        identity_text: input.identityText,
        audience_text: input.audienceText,
        reader_takeaway_text: input.readerTakeawayText,
        current_version: nextVersion,
      }, rules);
    });
  }

  async function setDefault(workspaceId, profileId) {
    const profile = await get(workspaceId, profileId);
    if (!profile || profile.status !== 'ACTIVE') throw new Error('只能将当前工作空间中启用的账号声音设为默认。');
    await query(`INSERT INTO account_voice_defaults (workspace_id, profile_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id) DO UPDATE SET profile_id = excluded.profile_id, updated_at = now()`, [workspaceId, profileId]);
    return profile;
  }

  async function addCalibration(workspaceId, profileId, input) {
    const profile = await get(workspaceId, profileId);
    if (!profile) { const error = new Error('未找到账号声音。'); error.statusCode = 404; throw error; }
    const result = await query(`INSERT INTO account_voice_calibrations
      (profile_id, source_type, title, source_url, file_reference, rule_summary, confirmed_licensed)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id, source_type, title, source_url, file_reference, rule_summary, created_at`, [
      profileId,
      input.sourceType,
      input.title,
      input.sourceUrl ?? null,
      input.fileReference ?? null,
      input.ruleSummary,
    ]);
    return result.rows[0];
  }

  async function getWritingSnapshot(workspaceId, profileId, offset = 'DEFAULT') {
    const profile = await get(workspaceId, profileId);
    if (!profile || profile.status !== 'ACTIVE') return null;
    return { id: profile.id, name: profile.name, version: profile.version, rules: profile.rules, offset };
  }

  return { list, get, create, update, setDefault, addCalibration, getWritingSnapshot };
}

module.exports = {
  VOICE_ARCHETYPES,
  VOICE_OFFSETS,
  COMMON_BANNED_PHRASES,
  COMMON_BANNED_STRUCTURES,
  voiceRulesSchema,
  accountVoiceInput,
  accountVoiceCalibrationInput,
  buildInitialVoiceRules,
  createAccountVoiceStore,
};
