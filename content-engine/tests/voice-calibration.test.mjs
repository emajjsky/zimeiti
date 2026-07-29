import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountVoiceCalibrationDraftInput,
  buildVoiceCalibrationPrompt,
  parseVoiceCalibrationDraft,
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
  assert.match(prompt.message, /一篇属于我的旧文章/);
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
    },
    ruleSummary: '先判断后展开，表达克制，收束自然。',
  }));

  assert.equal(draft.name, '我的旧文表达');
  assert.equal(draft.editedRules.bannedPhrases[0], '很多人会问');
});
