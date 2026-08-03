import assert from 'node:assert/strict';
import test from 'node:test';
import { writingBriefInput } from '../server/services/writing-brief.cjs';

test('账号声音替代语言风格 Skill，历史 VOICE 字段允许为空', () => {
  const result = writingBriefInput.parse({
    objective: '', targetAudience: '', coreMessage: '', sourceRequirements: '', lengthTarget: '', selectedPlatforms: ['WECHAT'], notes: '',
    selectedSkills: { SUBJECT: 'subject', CONTENT_TYPE: 'content', VOICE: '', LAYOUT: '', CHANNEL: '' },
    platformSkills: { WECHAT: { LAYOUT: 'layout', CHANNEL: 'channel' } },
  });
  assert.equal(result.selectedSkills.VOICE, '');
});

const brief = {
  objective: '解释如何判断 AI 工具价值',
  targetAudience: '普通创作者',
  coreMessage: '先看真实任务和可验证结果',
  sourceRequirements: '',
  lengthTarget: '1800-2200 字',
  selectedPlatforms: ['WECHAT'],
  notes: '',
  selectedSkills: {
    SUBJECT: 'subject-version',
    CONTENT_TYPE: 'content-version',
    VOICE: 'voice-version',
    LAYOUT: '',
    CHANNEL: '',
  },
  platformSkills: {
    WECHAT: { LAYOUT: 'layout-version', CHANNEL: 'channel-version' },
  },
};

test('写作概览允许共享 LAYOUT 和 CHANNEL 为空并使用平台规则', () => {
  const result = writingBriefInput.parse(brief);
  assert.equal(result.selectedSkills.LAYOUT, '');
  assert.equal(result.selectedSkills.CHANNEL, '');
  assert.equal(result.platformSkills.WECHAT.CHANNEL, 'channel-version');
});

test('已选平台仍必须配置独立渠道规则', () => {
  assert.throws(
    () => writingBriefInput.parse({ ...brief, platformSkills: { WECHAT: { LAYOUT: 'layout-version' } } }),
    /公众号写作规则/,
  );
});

test('公众号母稿拒绝非公众号 selectedPlatforms', () => {
  assert.throws(
    () => writingBriefInput.parse({ ...brief, selectedPlatforms: ['WECHAT', 'XIAOHONGSHU'] }),
    /Invalid input|Too big|array/i,
  );
});

test('公众号母稿拒绝 platformSkills 中的额外平台', () => {
  assert.throws(
    () => writingBriefInput.parse({
      ...brief,
      platformSkills: {
        ...brief.platformSkills,
        WEIBO: { LAYOUT: 'weibo-layout', CHANNEL: 'weibo-channel' },
      },
    }),
    /Unrecognized key|WEIBO/i,
  );
});

test('写作简报保存账号声音和本篇语气，而不是泛化语言风格', () => {
  const result = writingBriefInput.parse({ ...brief, accountVoiceProfileId: '715a27a6-38d7-4bcf-ab68-4765fbb0f697', voiceOffset: 'SHARPER' });
  assert.equal(result.accountVoiceProfileId, '715a27a6-38d7-4bcf-ab68-4765fbb0f697');
  assert.equal(result.voiceOffset, 'SHARPER');
});
