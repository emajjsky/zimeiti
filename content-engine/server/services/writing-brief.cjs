const { z } = require('zod');

const creativePlatform = z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']);
const creativePlatformNames = { WECHAT: '公众号', XIAOHONGSHU: '小红书', ZHIHU: '知乎', WEIBO: '微博' };
const platformSkillInput = z.object({
  LAYOUT: z.string().min(1).max(160).optional(),
  CHANNEL: z.string().min(1).max(160).optional(),
  lengthTarget: z.string().min(1).max(120).optional(),
});

const writingBriefInput = z.object({
  objective: z.string().max(2_000),
  targetAudience: z.string().max(1_000),
  coreMessage: z.string().max(4_000),
  sourceRequirements: z.string().max(4_000),
  lengthTarget: z.string().max(120),
  selectedPlatforms: z.array(creativePlatform).min(1).max(4),
  notes: z.string().max(4_000),
  accountVoiceProfileId: z.string().uuid().or(z.literal('')).default(''),
  voiceOffset: z.enum(['DEFAULT', 'MORE_RESTRAINED', 'SHARPER', 'MORE_PERSONAL', 'MORE_NARRATIVE']).default('DEFAULT'),
  selectedSkills: z.object({
    SUBJECT: z.string().min(1).max(160),
    CONTENT_TYPE: z.string().min(1).max(160),
    VOICE: z.string().max(160).default(''),
    LAYOUT: z.string().max(160).default(''),
    CHANNEL: z.string().max(160).default(''),
  }),
  platformSkills: z.object({
    WECHAT: platformSkillInput.optional(),
    XIAOHONGSHU: platformSkillInput.optional(),
    ZHIHU: platformSkillInput.optional(),
    WEIBO: platformSkillInput.optional(),
  }),
}).superRefine((value, context) => {
  for (const platform of value.selectedPlatforms) {
    if (!value.platformSkills[platform]?.CHANNEL) context.addIssue({ code: 'custom', path: ['platformSkills', platform], message: `请配置${creativePlatformNames[platform]}写作规则。` });
  }
});

module.exports = { writingBriefInput };
