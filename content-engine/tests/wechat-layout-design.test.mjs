import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WECHAT_LAYOUT_RULES, renderWechatDraft } from '../server/services/wechat-layout-renderer.cjs';
import {
  WECHAT_LAYOUT_DESIGN_SCOPE,
  buildWechatLayoutDesignPrompt,
  parseWechatLayoutDesignContent,
} from '../server/services/wechat-layout-design.cjs';

test('智能精排使用独立任务 Scope 并禁止模型输出最终 HTML', () => {
  assert.equal(WECHAT_LAYOUT_DESIGN_SCOPE, 'WECHAT_LAYOUT_DESIGN');
  const prompt = buildWechatLayoutDesignPrompt({
    title: 'AI 工具人的产线进化',
    body: '市场越热的时候，越要回到真实价值。\n\n真正值得长期投入的公司，不只要站在技术变化的起点。',
    assets: [{ assetId: '11111111-1111-4111-8111-111111111111', role: 'COVER' }],
    templateRules: DEFAULT_WECHAT_LAYOUT_RULES,
    instruction: '突出关键词和章节节奏',
  });
  assert.match(prompt.system.join('\n'), /WECHAT_LAYOUT_DESIGN/);
  assert.match(prompt.system.join('\n'), /禁止返回 HTML/);
  assert.match(prompt.user, /突出关键词和章节节奏/);
  assert.match(prompt.user, /templateRules/);
});

test('智能精排输出被规范为安全的结构化标注', () => {
  const parsed = parseWechatLayoutDesignContent(JSON.stringify({
    schemaVersion: 1,
    notes: '突出投资判断',
    blocks: [
      { paragraphIndex: 1, role: 'lead', variant: 'accent-line' },
      { paragraphIndex: 2, role: 'key-judgement', variant: 'callout' },
      { paragraphIndex: 99, role: 'lead', variant: 'card', html: '<b>bad</b>' },
    ],
    inlineMarks: [
      { text: '真实价值', type: 'strong-accent' },
      { text: '长期投入', type: 'marker' },
      { text: '<script>', type: 'strong-accent' },
    ],
  }), { paragraphCount: 2 });
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    notes: '突出投资判断',
    blocks: [
      { paragraphIndex: 1, role: 'lead', variant: 'accent-line' },
      { paragraphIndex: 2, role: 'key-judgement', variant: 'callout' },
    ],
    inlineMarks: [
      { text: '真实价值', type: 'strong-accent' },
      { text: '长期投入', type: 'marker' },
    ],
  });
});

test('渲染器按模板配色应用智能精排重点词和重点段落', () => {
  const rules = {
    ...DEFAULT_WECHAT_LAYOUT_RULES,
    heading: { ...DEFAULT_WECHAT_LAYOUT_RULES.heading, color: '#1234aa', borderColor: '#1234aa' },
    quote: { ...DEFAULT_WECHAT_LAYOUT_RULES.quote, background: '#eef3ff', borderColor: '#1234aa' },
    layout: { ...DEFAULT_WECHAT_LAYOUT_RULES.layout, inlineVariant: 'accent' },
  };
  const { html } = renderWechatDraft({
    title: '蓝驰陈维广谈数据',
    body: '市场越热的时候，越要回到真实价值。\n\n真正值得长期投入的公司，不只要站在技术变化的起点。',
    assets: [],
    templateRules: rules,
    layoutDesign: {
      schemaVersion: 1,
      blocks: [{ paragraphIndex: 1, role: 'lead', variant: 'accent-line' }],
      inlineMarks: [{ text: '真实价值', type: 'strong-accent' }, { text: '长期投入', type: 'marker' }],
    },
  });
  assert.match(html, /data-layout-design-block="lead"/);
  assert.match(html, /border-left:5px solid #1234aa/);
  assert.match(html, /<strong style="[^"]*color:#1234aa[^"]*">真实价值<\/strong>/);
  assert.match(html, /<mark style="[^"]*background:#eef3ff[^"]*">长期投入<\/mark>/);
});
