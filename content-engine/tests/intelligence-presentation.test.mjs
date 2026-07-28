import assert from 'node:assert/strict';
import test from 'node:test';

const presentation = await import('../shared/intelligence-presentation.mjs').catch(() => null);
const now = new Date('2026-07-26T10:30:00+08:00').valueOf();

test('热点时间按今天、昨天和具体日期显示', () => {
  assert.ok(presentation, '热点展示规则尚未实现');
  assert.equal(presentation.formatIntelligenceTime('2026-07-26T08:15:00+08:00', now), '今天 08:15');
  assert.equal(presentation.formatIntelligenceTime('2026-07-25T09:20:00+08:00', now), '昨天 09:20');
  assert.equal(presentation.formatIntelligenceTime('2026-07-21T16:40:00+08:00', now), '07-21 16:40');
  assert.equal(presentation.formatIntelligenceTime('刚刚', now), '刚刚');
});

test('来源和标签颜色由文本稳定映射', () => {
  assert.ok(presentation, '热点展示规则尚未实现');
  assert.equal(presentation.toneForValue('中国新闻网'), presentation.toneForValue('中国新闻网'));
  assert.match(presentation.toneForValue('科技'), /^tone-(blue|mint|yellow|coral|lilac)$/);
});

test('热点已加入状态只由项目来源引用决定', () => {
  assert.ok(presentation, '热点展示规则尚未实现');
  const projects = [
    { id: 'project-1', originType: 'HOTSPOT', originReferenceId: 'intel-1' },
    { id: 'project-2', originType: 'MANUAL', originReferenceId: 'intel-2' },
  ];
  assert.equal(presentation.projectForIntelligence(projects, 'intel-1')?.id, 'project-1');
  assert.equal(presentation.projectForIntelligence(projects, 'intel-2'), undefined);
  assert.equal(presentation.projectForIntelligence(projects, 'intel-3'), undefined);
});
