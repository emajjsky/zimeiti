import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { VOICE_ARCHETYPES, buildInitialVoiceRules, createAccountVoiceStore } from '../server/services/accountVoices.cjs';

test('账号声音原型提供具体写法与禁区，而不是泛化风格标签', () => {
  assert.deepEqual(VOICE_ARCHETYPES.map((item) => item.slug), [
    'say-it-through',
    'field-notes',
    'calm-commentary',
    'talk-to-a-friend',
    'slow-narrative',
    'hardcore-breakdown',
  ]);
  assert.ok(VOICE_ARCHETYPES.every((item) => item.doRules.length > 0 && item.avoidRules.length > 0));
  assert.ok(VOICE_ARCHETYPES.every((item) => !/清新|故事化|高级感/.test(item.name)));
});

test('初始声音规则继承原型并明确禁止 AI 套话', () => {
  const rules = buildInitialVoiceRules({
    archetypeSlug: 'say-it-through',
    identityText: '长期关注科技行业的普通从业者',
    audienceText: '不想被行业黑话绕晕的普通读者',
    readerTakeawayText: '看完知道事情的边界，而不只记住一个结论',
  });

  assert.match(rules.opening, /判断|事实|观察/);
  assert.match(rules.identityBoundary, /普通从业者/);
  assert.ok(rules.bannedPhrases.includes('很多人会问'));
  assert.ok(rules.bannedPhrases.includes('今天我们就来'));
  assert.ok(rules.bannedStructures.includes('emoji 小标题'));
});

test('账号声音更新会保留旧规则版本并写入新版本', async () => {
  const operations = [];
  const profile = {
    id: 'voice-1', workspace_id: 'workspace-1', name: '把话说透', archetype_slug: 'say-it-through',
    identity_text: '科技从业者', audience_text: '普通读者', reader_takeaway_text: '理解边界',
    status: 'ACTIVE', current_version: 1, created_at: '2026-07-29T00:00:00.000Z', updated_at: '2026-07-29T00:00:00.000Z',
  };
  const query = async (sql, values) => {
    operations.push({ sql, values });
    if (/SELECT .*account_voice_profiles/s.test(sql)) return { rowCount: 1, rows: [profile] };
    return { rowCount: 1, rows: [] };
  };
  const store = createAccountVoiceStore({
    query,
    transaction: async (callback) => callback({ query }),
  });

  const updated = await store.update('workspace-1', 'voice-1', {
    name: '把话说透·新版',
    archetypeSlug: 'say-it-through',
    identityText: '科技从业者',
    audienceText: '普通读者',
    readerTakeawayText: '理解边界',
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.name, '把话说透·新版');
  assert.equal(operations.filter(({ sql }) => /INSERT INTO account_voice_versions/.test(sql)).length, 1);
  assert.equal(operations.filter(({ sql }) => /UPDATE account_voice_profiles/.test(sql)).length, 1);
});

test('账号声音迁移保留版本、默认绑定和简报偏移字段', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/022_account_voice_profiles.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE account_voice_profiles/);
  assert.match(migration, /CREATE TABLE account_voice_versions/);
  assert.match(migration, /CREATE TABLE account_voice_defaults/);
  assert.match(migration, /CREATE TABLE account_voice_calibrations/);
  assert.match(migration, /ADD COLUMN account_voice_profile_id uuid/);
  assert.match(migration, /voice_offset text NOT NULL DEFAULT 'DEFAULT'/);
});
