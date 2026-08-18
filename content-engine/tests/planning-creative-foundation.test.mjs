import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankProject,
  createProjectFromIntelligence,
  confirmProjectPlanning,
  migrateLegacyCreativeState,
  saveProjectPlanning,
  saveWorkspacePreferences,
  updateCreativeProjects,
} from '../server/services/project-planning.cjs';

test('旧选题被幂等迁移为规划阶段项目且不再保留 topics', () => {
  const legacy = {
    workspace: { enabledPlatforms: ['WECHAT'] },
    topics: [{
      id: 'topic-1',
      title: '普通人怎么用 AI 做图',
      category: 'AI',
      platforms: ['WECHAT'],
      urgency: '高',
      status: 'PENDING',
      coreViewpoint: '先解决真实问题',
      targetAudience: '新手',
      factsToVerify: ['核对价格'],
      sourceIds: ['intel-1'],
    }],
    projects: [],
  };

  const first = migrateLegacyCreativeState(legacy, '2026-07-28T08:00:00.000Z');
  const second = migrateLegacyCreativeState(first, '2026-07-28T09:00:00.000Z');

  assert.equal('topics' in first, false);
  assert.equal(first.projects.length, 1);
  assert.equal(first.projects[0].stage, 'PLANNING');
  assert.equal(first.projects[0].originType, 'HOTSPOT');
  assert.equal(first.projects[0].originReferenceId, 'intel-1');
  assert.equal(first.projects[0].legacyTopicId, 'topic-1');
  assert.equal(first.projects[0].planning.targetAudience, '新手');
  assert.deepEqual(second, first);
});

test('旧内容项目按既有状态补齐统一阶段且保留正文版本', () => {
  const state = migrateLegacyCreativeState({
    projects: [{
      id: 'project-1',
      title: '一篇旧文章',
      status: 'WRITING',
      coreViewpoint: '旧观点',
      factChecks: ['核对来源'],
      updatedAt: '2026-07-27T10:00:00.000Z',
      versions: [{
        id: 'version-1',
        platform: 'WECHAT',
        status: 'DRAFT',
        title: '旧标题',
        body: '旧正文',
        updatedAt: '2026-07-27T10:00:00.000Z',
      }],
    }],
  }, '2026-07-28T08:00:00.000Z');

  assert.equal(state.projects[0].stage, 'MASTER_WRITING');
  assert.equal(state.projects[0].originType, 'LEGACY');
  assert.equal(state.projects[0].planning.targetPlatforms[0], 'WECHAT');
  assert.equal(state.projects[0].versions[0].body, '旧正文');
});

test('热点分析创建项目时冻结角度、受众、公众号母稿、时效和待核验项', () => {
  const project = createProjectFromIntelligence({
    id: 'intel-1',
    title: '模型价格下降',
    summary: '普通创作者的成本继续下降',
    category: '财经',
    source: '官方公告',
    publishedAt: '2026-07-28T07:00:00.000Z',
    heat: 88,
    trust: '可信',
  }, {
    selectedPlatforms: ['WECHAT', 'ZHIHU'],
    decisionReason: '适合立即跟进',
    timingWindow: 'TODAY',
    overallScore: 90,
    decision: 'FOLLOW',
    factsToVerify: ['核对生效日期'],
    angles: [{
      title: '模型降价后，创作者真正应该关注什么',
      coreViewpoint: '成本下降不等于内容质量自动提升',
      targetAudience: '使用模型 API 的个人创作者',
    }],
    platforms: [],
  }, 0, '2026-07-28T08:00:00.000Z');

  assert.equal(project.originType, 'HOTSPOT');
  assert.equal(project.originReferenceId, 'intel-1');
  assert.equal(project.planning.title, '模型降价后，创作者真正应该关注什么');
  assert.equal(project.planning.angle, '适合立即跟进');
  assert.equal(project.planning.targetAudience, '使用模型 API 的个人创作者');
  assert.deepEqual(project.planning.targetPlatforms, ['WECHAT']);
  assert.equal(project.planning.timing, 'TODAY');
  assert.deepEqual(project.factChecks, ['核对生效日期']);
  assert.equal(project.versions.length, 0);
});

test('空白创作项目不把草稿片段伪装成规划核心表达', () => {
  const project = createBlankProject({
    originType: 'MANUAL',
    title: '我想写一次工具复盘',
    category: 'AI',
    draftText: '这是我自己记录的草稿片段。',
    targetPlatforms: ['WECHAT'],
  }, '2026-07-28T08:00:00.000Z');

  assert.equal(project.stage, 'PLANNING');
  assert.equal(project.planning.title, '我想写一次工具复盘');
  assert.equal(project.planning.targetPlatforms[0], 'WECHAT');
  assert.equal(project.versions.length, 0);
  assert.equal(project.planning.coreMessage, '');
  assert.equal('draftText' in project.sourceSnapshot, false);
});

test('规划确认拒绝把待核验能力主张直接写进标题', () => {
  const claim = 'Wan3.0 首次支持 doc、xls、ppt、pdf、md 等文档格式作为视频生成输入源';
  const project = createBlankProject({ title: '待规划项目', targetPlatforms: ['WECHAT'] }, '2026-07-28T08:00:00.000Z');
  const withCheck = { ...project, factChecks: [claim] };
  assert.throws(() => confirmProjectPlanning(withCheck, {
    title: claim,
    category: '科技',
    angle: '解释这项说法该如何核验',
    objective: '帮助读者建立判断',
    targetAudience: '普通读者',
    coreMessage: '先核验再下结论',
    targetPlatforms: ['WECHAT'],
  }), /标题|待核验/);
});

test('项目状态更新锁定工作空间且空变更不会写项目或快照', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT state_json/.test(sql)) return { rowCount: 1, rows: [{ state_json: { topics: [], projects: [] } }] };
      return { rows: [] };
    },
  };

  const next = await updateCreativeProjects(client, 'workspace-1', (state) => ({ ...state, projects: [] }), '2026-07-28T08:00:00.000Z');

  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.equal(calls.some(({ sql }) => /INSERT INTO content_projects/.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /UPDATE workspace_snapshots/.test(sql)), false);
  assert.deepEqual(next.projects, []);
});

test('单项目更新不会改写其他项目', async () => {
  const now = '2026-07-28T08:00:00.000Z';
  const first = createBlankProject({ title: '项目一', targetPlatforms: ['WECHAT'] }, now);
  const second = createBlankProject({ title: '项目二', targetPlatforms: ['WECHAT'] }, now);
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT state_json/.test(sql)) return { rowCount: 1, rows: [{ state_json: {} }] };
      if (/SELECT project_json, position/.test(sql)) return { rows: [{ project_json: first, position: 0 }, { project_json: second, position: 1 }] };
      return { rows: [] };
    },
  };

  await updateCreativeProjects(client, 'workspace-1', (state) => ({
    ...state,
    projects: state.projects.map((project) => project.id === first.id ? { ...project, title: '项目一已更新', updatedAt: '2026-07-28T09:00:00.000Z' } : project),
  }), '2026-07-28T09:00:00.000Z');

  const writes = calls.filter(({ sql }) => /INSERT INTO content_projects/.test(sql));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params[1], first.id);
});

test('工作空间偏好保存只写允许的偏好字段', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT state_json.*FOR UPDATE/.test(sql)) return { rowCount: 1, rows: [{ state_json: { workspace: { name: '旧名称' }, projects: [{ id: 'danger' }], sources: [{ id: 'source' }], intelligence: [{ id: 'item' }] } }] };
      if (/UPDATE workspace_snapshots/.test(sql)) return { rowCount: 1, rows: [{ revision: 3, updated_at: '2026-07-28T09:00:00.000Z' }] };
      return { rowCount: 0, rows: [] };
    },
  };

  await saveWorkspacePreferences(client, 'workspace-1', { workspace: { name: '新名称' } });

  const saved = JSON.parse(calls.find(({ sql }) => /UPDATE workspace_snapshots/.test(sql)).params[1]);
  assert.deepEqual(saved, { workspace: { name: '新名称' } });
  assert.equal(calls.some(({ sql }) => /content_projects/.test(sql)), false);
});

test('保存规划只更新工作稿，确认规划才推进研究并建立平台版本', () => {
  const project = createBlankProject({
    originType: 'MANUAL',
    title: 'AI 写作是否会让人变懒',
    targetPlatforms: ['WECHAT'],
  }, '2026-07-28T08:00:00.000Z');
  const draft = {
    ...project.planning,
    angle: '从认知外包边界切入',
    objective: '帮助普通人建立使用边界',
    targetAudience: '使用 AI 写作的普通创作者',
    coreMessage: 'AI 应该辅助判断而不是替代判断',
    sourceRequirements: '核对相关研究与产品能力',
  };

  const saved = saveProjectPlanning(project, draft, '2026-07-28T08:03:00.000Z');
  assert.equal(saved.stage, 'PLANNING');
  assert.equal(saved.planningVersion, 0);
  assert.equal(saved.versions.length, 0);

  const confirmed = confirmProjectPlanning(saved, saved.planning, '2026-07-28T08:05:00.000Z');
  assert.equal(confirmed.stage, 'RESEARCH');
  assert.equal(confirmed.planningVersion, 1);
  assert.equal(confirmed.planningConfirmedAt, '2026-07-28T08:05:00.000Z');
  assert.equal(confirmed.versions.length, 1);
  assert.equal(confirmed.versions[0].platform, 'WECHAT');
  assert.equal(confirmed.versions[0].body, '');
});

test('确认规划只在缺少标题或目标平台时阻断', () => {
  const project = createBlankProject({ originType: 'MANUAL', title: '一个想法', targetPlatforms: ['WECHAT'] }, '2026-07-28T08:00:00.000Z');
  const confirmed = confirmProjectPlanning(project, project.planning, '2026-07-28T08:05:00.000Z');
  assert.equal(confirmed.stage, 'RESEARCH');
  assert.ok(confirmed.planning.angle);
  assert.throws(() => confirmProjectPlanning(project, { ...project.planning, title: '', targetPlatforms: [] }, '2026-07-28T08:05:00.000Z'), /选题标题/);
});
