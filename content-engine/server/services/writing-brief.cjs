const { z } = require('zod');

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
  selectedPlatforms: z.tuple([z.literal('WECHAT')]),
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
  platformSkills: z.object({ WECHAT: platformSkillInput }).strict(),
}).superRefine((value, context) => {
  if (!value.platformSkills.WECHAT.LAYOUT || !value.platformSkills.WECHAT.CHANNEL) {
    context.addIssue({ code: 'custom', path: ['platformSkills', 'WECHAT'], message: '请配置公众号写作规则。' });
  }
});

module.exports = { writingBriefInput };
