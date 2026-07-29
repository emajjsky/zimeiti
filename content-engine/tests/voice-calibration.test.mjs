import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountVoiceCalibrationDraftInput,
  buildVoiceCalibrationRepairPrompt,
  buildVoiceCalibrationPrompt,
  parseVoiceCalibrationDraft,
  voiceCalibrationErrorMessage,
} from '../server/services/voiceCalibration.cjs';

const article = {
  title: '一篇属于我的旧文章',
  url: 'https://example.com/my-article',
  source: '示例媒体',
  text: '这是公开文章正文。它有自己的节奏、观点和表达方式。'.repeat(20),
};

test('账号声音蒸馏必须取得文章使用授权', () => {
  assert.throws(() => accountVoiceCalibrationDraftInput.parse({
    sourceUrl: article.url,
    confirmedLicensed: false,
  }), /拥有这篇文章的使用权/);
});

test('蒸馏提示词只用于提炼表达规则，不要求模仿作者或复写全文', () => {
  const prompt = buildVoiceCalibrationPrompt(article);
  assert.match(prompt.system, /表达规则/);
  assert.match(prompt.system, /不得模仿/);
  assert.match(prompt.system, /不得复写/);
  assert.match(prompt.system, /不得输出脱离样本的通用规则/);
  assert.match(prompt.message, /一篇属于我的旧文章/);
});

test('蒸馏结构不完整时，修复提示词要求补全诊断和执行规则', () => {
  const repair = buildVoiceCalibrationRepairPrompt('原始规则', '缺少 diagnostics');
  assert.match(repair, /完整修正后的 JSON/);
  assert.match(repair, /不得删减 diagnostics/);
});

test('蒸馏结果必须是可保存的结构化账号声音草案', () => {
  const draft = parseVoiceCalibrationDraft(JSON.stringify({
    name: '我的旧文表达',
    archetypeSlug: 'say-it-through',
    identityText: '以账号作者真实提供的材料和判断为边界。',
    audienceText: '希望快速理解复杂问题的普通读者。',
    readerTakeawayText: '读完知道判断依据与适用边界。',
    editedRules: {
      opening: '先从可验证的事实或明确判断进入。',
      reasoning: '按事实、推理和边界逐层展开。',
      rhythm: '短中句交替，一段推进一个意思。',
      ending: '自然收束到可执行判断，不索要互动。',
      identityBoundary: '不虚构作者经历、身份或立场。',
      audience: '希望快速理解复杂问题的普通读者。',
      readerTakeaway: '读完知道判断依据与适用边界。',
      allowedPhrases: ['先把事实放在前面'],
      bannedPhrases: ['很多人会问'],
      bannedStructures: ['emoji 小标题'],
      hookPatterns: ['先抛出具体反常识判断，再解释原因', '从读者熟悉的具体场景快速切入'],
      argumentPattern: '以一个核心判断为轴，按现象、原因、边界递进。',
      evidenceStyle: '用具体案例和可核验细节支撑判断，不堆术语。',
      paragraphPattern: '短段落推进，转折处单独成段。',
      languageTexture: '口语化但克制，少用形容词堆砌。',
      readerRelationship: '像与熟悉但不完全同意的读者一起推理。',
      titlePatterns: ['明确对象 + 判断', '现象 + 为什么'],
      closingStyle: '回到开头的判断，留下下一步观察点。',
    },
    ruleSummary: '先判断后展开，表达克制，收束自然。',
    analysis: {
      confidence: 'LOW',
      voiceFingerprint: '以具体现象切入的克制型判断写法。',
      diagnostics: [
        { dimension: '开篇钩子', finding: '前两段快速落到具体判断。', evidence: '开头没有背景铺陈，先给出结论方向。' },
        { dimension: '论证推进', finding: '先描述现象，再逐层解释原因和限制。', evidence: '每一节都围绕一个原因展开后再回到判断。' },
        { dimension: '证据方式', finding: '案例与具体细节服务于前面的判断。', evidence: '每个细节之后都紧跟解释，而非单独罗列。' },
        { dimension: '段落节奏', finding: '短段落推进，转折位置刻意留出停顿。', evidence: '出现转折时会独立成段，使读者重置阅读节奏。' },
        { dimension: '语言颗粒', finding: '少修辞，多使用直白但有边界的判断句。', evidence: '全文形容词密度低，限定词主要用于说明边界。' },
        { dimension: '收束方式', finding: '结尾回到核心判断，不强行索取读者互动。', evidence: '末段收束观点，没有出现点赞、收藏或评论引导。' },
      ],
    },
  }));

  assert.equal(draft.name, '我的旧文表达');
  assert.equal(draft.editedRules.bannedPhrases[0], '很多人会问');
  assert.equal(draft.analysis.diagnostics.length, 6);
  assert.match(draft.editedRules.argumentPattern, /核心判断/);
});

test('蒸馏结果缺少读者关系规则时，使用同维度样本诊断补足', () => {
  const draft = parseVoiceCalibrationDraft(JSON.stringify({
    name: '我的旧文表达',
    archetypeSlug: 'say-it-through',
    identityText: '只使用用户已提供或可验证的材料。',
    audienceText: '希望快速理解复杂问题的普通读者。',
    readerTakeawayText: '读完知道判断依据和适用边界。',
    editedRules: {
      opening: '从具体观察进入，不用空泛背景铺陈。', reasoning: '按事实、判断和边界逐层展开。', rhythm: '短中句交替，一段只推进一个意思。', ending: '回到判断并自然收束。',
      identityBoundary: '不虚构账号作者的经历、身份或立场。', audience: '希望快速理解复杂问题的普通读者。', readerTakeaway: '读完知道判断依据和适用边界。',
      allowedPhrases: [], bannedPhrases: ['很多人会问'], bannedStructures: ['emoji 小标题'],
      argumentPattern: '以核心判断为轴，按现象、原因和边界递进。', evidenceStyle: '使用具体细节支撑观点，不堆砌术语。', paragraphPattern: '每段只推进一个意思，转折时独立成段。', languageTexture: '表达克制直接，少用夸张形容词。',
      closingStyle: '回到核心判断，留下观察边界。',
    },
    ruleSummary: '从具体观察进入，以判断和证据逐层推进。',
    analysis: {
      confidence: 'LOW', voiceFingerprint: '从具体现象切入的克制型判断写法。',
      diagnostics: [
        { dimension: '标题', finding: '标题直接点出对象和问题。', evidence: '标题先交代讨论对象，再给出读者需要解决的问题。' },
        { dimension: '开篇钩子', finding: '开头快速落到具体情境。', evidence: '前两段没有背景铺陈，而是先给出可感知的观察。' },
        { dimension: '论证推进', finding: '观点与原因逐层推进。', evidence: '每一节都围绕一个理由展开后，再回到核心判断。' },
        { dimension: '证据方式', finding: '细节紧跟解释出现。', evidence: '具体细节后面紧接判断说明，而非单独罗列信息。' },
        { dimension: '段落节奏', finding: '转折位置会独立成段。', evidence: '出现转折时留出停顿，让读者重新进入下一层论证。' },
        { dimension: '读者关系', finding: '像与读者一起推理。', evidence: '文中持续解释判断依据，不替读者预设结论或情绪。' },
      ],
    },
  }));

  assert.match(draft.editedRules.readerRelationship, /一起推理/);
  assert.equal(draft.editedRules.hookPatterns.length, 2);
  assert.equal(draft.editedRules.titlePatterns.length, 2);
});

test('蒸馏诊断维度允许带描述后缀并归一为标准标签', () => {
  const base = {
    name: '我的旧文表达', archetypeSlug: 'say-it-through', identityText: '只使用用户已提供或可验证的材料。', audienceText: '希望快速理解复杂问题的普通读者。', readerTakeawayText: '读完知道判断依据和适用边界。',
    editedRules: { opening: '从具体观察进入，不用空泛背景铺陈。', reasoning: '按事实、判断和边界逐层展开。', rhythm: '短中句交替，一段只推进一个意思。', ending: '回到判断并自然收束。', identityBoundary: '不虚构账号作者的经历、身份或立场。', audience: '希望快速理解复杂问题的普通读者。', readerTakeaway: '读完知道判断依据和适用边界。', allowedPhrases: [], bannedPhrases: ['很多人会问'], bannedStructures: ['emoji 小标题'], hookPatterns: ['从熟悉场景进入问题', '先抛出具体判断再解释'], argumentPattern: '以核心判断为轴，按现象、原因和边界递进。', evidenceStyle: '使用具体细节支撑观点，不堆砌术语。', paragraphPattern: '每段只推进一个意思，转折时独立成段。', languageTexture: '表达克制直接，少用夸张形容词。', readerRelationship: '像与读者一起推理，不替读者预设结论。', titlePatterns: ['明确对象加判断', '现象加原因'], closingStyle: '回到核心判断，留下观察边界。' },
    ruleSummary: '从具体观察进入，以判断和证据逐层推进。',
    analysis: { confidence: 'LOW', voiceFingerprint: '从具体现象切入的克制型判断写法。', diagnostics: [
      { dimension: '标题套路', finding: '标题直接点出对象和问题。', evidence: '标题先交代讨论对象，再给出读者需要解决的问题。' },
      { dimension: '开篇钩子（场景）', finding: '开头快速落到具体情境。', evidence: '前两段没有背景铺陈，而是先给出可感知的观察。' },
      { dimension: '论证推进方式', finding: '观点与原因逐层推进。', evidence: '每一节都围绕一个理由展开后，再回到核心判断。' },
      { dimension: '证据方式', finding: '细节紧跟解释出现。', evidence: '具体细节后面紧接判断说明，而非单独罗列信息。' },
      { dimension: '段落节奏', finding: '转折位置会独立成段。', evidence: '出现转折时留出停顿，让读者重新进入下一层论证。' },
      { dimension: '读者关系', finding: '像与读者一起推理。', evidence: '文中持续解释判断依据，不替读者预设结论或情绪。' },
    ] },
  };
  const draft = parseVoiceCalibrationDraft(JSON.stringify(base));
  assert.equal(draft.analysis.diagnostics[0].dimension, '标题');
  assert.equal(draft.analysis.diagnostics[1].dimension, '开篇钩子');
  assert.equal(draft.analysis.diagnostics[2].dimension, '论证推进');
});

test('蒸馏结构仍无法修复时返回可行动的用户提示', () => {
  assert.equal(voiceCalibrationErrorMessage({ issues: [{ path: ['analysis'] }] }), '模型返回的账号声音结构不完整，已尝试修复，请重新提炼。');
});
