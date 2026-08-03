import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildSourceVerificationPrompt,
  defaultSourceVerificationTemplate,
  parseSourceVerification,
  mergeSourceVerificationResults,
  SOURCE_VERIFICATION_SCOPE,
  SOURCE_VERIFICATION_VERSION,
  validateSourceVerificationTemplate,
} from '../server/services/source-verification.cjs';

const context = {
  claims: [
    { claim: '产品已向全部免费用户开放。', priority: 'HIGH', reason: '影响核心结论。' },
    { claim: '产品支持批量导出。', priority: 'MEDIUM', reason: '影响使用建议。' },
  ],
  sources: [
    { id: 'source-a', title: '官方公告', url: 'https://example.com/a', source: '官方网站', summary: '官方公告称，产品已向全部免费用户开放。' },
    { id: 'source-b', title: '帮助文档', url: 'https://example.com/b', source: '帮助中心', summary: '帮助文档仅说明付费用户支持批量导出。' },
  ],
};

const validOutput = {
  summary: '一项主张得到单一来源支持，另一项仍需复核。',
  claims: [
    {
      claim: '产品已向全部免费用户开放。',
      status: 'SINGLE_SOURCE',
      explanation: '只有官方公告直接支持该主张。',
      evidence: [{ sourceId: 'source-a', relation: 'SUPPORTS', quote: '产品已向全部免费用户开放', note: '官方直接表述。' }],
    },
    {
      claim: '产品支持批量导出。',
      status: 'NEEDS_REVIEW',
      explanation: '现有来源限定为付费用户，不能支持无条件表述。',
      evidence: [{ sourceId: 'source-b', relation: 'CONFLICTS', quote: '付费用户支持批量导出', note: '适用范围存在限制。' }],
    },
  ],
};

test('事实核验使用独立模型 Scope 和动作版本', () => {
  assert.equal(SOURCE_VERIFICATION_SCOPE, 'SOURCE_VERIFICATION');
  assert.equal(SOURCE_VERIFICATION_VERSION, 'source-verification:1.0.0');
});

test('事实核验只接受研究计划中的主张和已选来源引用', () => {
  const parsed = parseSourceVerification(JSON.stringify(validOutput), context);
  assert.equal(parsed.claims[0].evidence[0].url, 'https://example.com/a');
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{ ...validOutput.claims[0], evidence: [{ ...validOutput.claims[0].evidence[0], sourceId: 'source-x' }] }, validOutput.claims[1]],
  }), context), /未选来源/);
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{ ...validOutput.claims[0], evidence: [{ ...validOutput.claims[0].evidence[0], quote: '摘要中不存在的原文' }] }, validOutput.claims[1]],
  }), context), /无法在来源摘要中定位/);
});

test('事实核验必须逐条返回且不能重复主张', () => {
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [validOutput.claims[0], validOutput.claims[0]],
  }), context), /逐条对应/);
});

test('单一支持来源不能标记为多源核验通过', () => {
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{ ...validOutput.claims[0], status: 'VERIFIED' }, validOutput.claims[1]],
  }), context), /至少两个独立支持来源/);
});

test('单一来源状态必须包含且只包含一个支持来源', () => {
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{ ...validOutput.claims[0], evidence: [] }, validOutput.claims[1]],
  }), context), /SINGLE_SOURCE/);
});

test('引用归一化后不能为空', () => {
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{
      ...validOutput.claims[0],
      evidence: [{ ...validOutput.claims[0].evidence[0], quote: '，。！？' }],
    }, validOutput.claims[1]],
  }), context), /无法在来源摘要中定位/);
});

test('修复输出中的坏引用只隔离对应主张，不污染其它有效结论', () => {
  const recovered = parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [
      validOutput.claims[0],
      { ...validOutput.claims[1], status: 'SINGLE_SOURCE', evidence: [{ sourceId: 'source-b', relation: 'SUPPORTS', quote: '摘要中不存在的原文', note: '无效引用。' }] },
    ],
  }), { ...context, recoverInvalidClaims: true });

  assert.equal(recovered.claims[0].status, 'SINGLE_SOURCE');
  assert.equal(recovered.claims[1].status, 'NEEDS_REVIEW');
  assert.equal(recovered.claims[1].evidence.length, 0);
  assert.equal(recovered.claims[1].evidenceValidationFailed, true);
});

test('多源通过状态不能同时包含冲突证据', () => {
  const sourceC = { id: 'source-c', title: '第二份公告', url: 'https://example.com/c', source: '公告平台', summary: '产品已向全部免费用户开放。' };
  assert.throws(() => parseSourceVerification(JSON.stringify({
    ...validOutput,
    claims: [{
      ...validOutput.claims[0],
      status: 'VERIFIED',
      evidence: [
        validOutput.claims[0].evidence[0],
        { ...validOutput.claims[0].evidence[0], sourceId: 'source-c' },
        { sourceId: 'source-b', relation: 'CONFLICTS', quote: '付费用户支持批量导出', note: '适用范围冲突。' },
      ],
    }, validOutput.claims[1]],
  }), { ...context, sources: [...context.sources, sourceC] }), /VERIFIED.*冲突/);
});

test('事实核验提示词明确来源边界和逐条主张输出', () => {
  const prompt = buildSourceVerificationPrompt({ ...context, template: '优先核对适用范围和发布日期。' });
  assert.match(prompt.system, /只能引用本次已选来源/);
  assert.match(prompt.system, /优先核对适用范围和发布日期/);
  assert.match(prompt.system, /VERIFIED/);
  assert.match(prompt.message, /source-a/);
  assert.match(prompt.message, /产品支持批量导出/);
});

test('事实核验提示词模板可见可编辑且保留默认版本', () => {
  assert.match(defaultSourceVerificationTemplate(), /来源/);
  assert.equal(validateSourceVerificationTemplate('重点检查数字与适用范围。'), '重点检查数字与适用范围。');
  assert.throws(() => validateSourceVerificationTemplate(''), /不能为空/);
});

test('逐来源核验可隔离坏来源并合并仍然有效的单一来源结论', () => {
  assert.equal(typeof mergeSourceVerificationResults, 'function');
  const result = mergeSourceVerificationResults({
    claims: context.claims,
    results: [
      parseSourceVerification(JSON.stringify(validOutput), context),
      null,
    ],
  });

  assert.equal(result.claims[0].status, 'SINGLE_SOURCE');
  assert.equal(result.claims[0].evidence[0].sourceId, 'source-a');
  assert.equal(result.claims[1].status, 'NEEDS_REVIEW');
  assert.match(result.summary, /1 条获得单一来源支持/);
});

test('逐来源核验合并两个独立支持来源为多源核验通过', () => {
  const sourceC = { id: 'source-c', title: '第二份公告', url: 'https://example.com/c', source: '公告平台', summary: '产品已向全部免费用户开放。' };
  const second = {
    summary: '第二个来源支持第一项主张。',
    claims: [
      { claim: context.claims[0].claim, status: 'SINGLE_SOURCE', explanation: '第二份公告支持。', evidence: [{ sourceId: 'source-c', relation: 'SUPPORTS', quote: '产品已向全部免费用户开放', note: '直接表述。' }] },
      { claim: context.claims[1].claim, status: 'NEEDS_REVIEW', explanation: '没有证据。', evidence: [] },
    ],
  };
  const merged = mergeSourceVerificationResults({
    claims: context.claims,
    results: [validOutput, parseSourceVerification(JSON.stringify(second), { ...context, sources: [sourceC] })],
  });
  assert.equal(merged.claims[0].status, 'VERIFIED');
  assert.equal(merged.claims[0].evidence.length, 2);
});

test('迁移保存来源质量选择和事实核验产物', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/020_source_verification.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN metadata_json jsonb/);
  assert.match(migration, /ADD COLUMN selected boolean/);
  assert.match(migration, /CREATE TABLE project_source_verifications/);
  assert.match(migration, /RESEARCH_VERIFICATION/);
  assert.match(migration, /source-verification:1\.0\.0/);
});

test('事实核验 prepare 只冻结选择，confirm 才入队', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepareStart = server.indexOf('/research/verification/prepare');
  const confirmStart = server.indexOf('/source-verification-runs/:id/confirm');
  const cancelStart = server.indexOf('/source-verification-runs/:id/cancel');
  assert.ok(prepareStart > -1 && confirmStart > prepareStart && cancelStart > confirmStart);
  const prepare = server.slice(prepareStart, confirmStart);
  const confirm = server.slice(confirmStart, cancelStart);
  assert.match(prepare, /SOURCE_VERIFICATION_SCOPE/);
  assert.match(prepare, /selectedSourceIds/);
  assert.match(prepare, /textTaskRoute/);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /SOURCE_VERIFICATION/);
  assert.match(confirm, /await enqueue/);
});

test('Worker 执行事实核验并记录独立调用日志', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.match(worker, /queueJob\.name === 'SOURCE_VERIFICATION'/);
  assert.match(worker, /buildSourceVerificationPrompt/);
  assert.match(worker, /parseSourceVerification/);
  assert.match(worker, /project_source_verifications/);
  assert.match(worker, /'SOURCE_VERIFICATION', 'SUCCESS'/);
});

test('模型任务设置提供事实核验文本模型 Scope', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const integrations = fs.readFileSync(new URL('../src/domain/integrations.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(server, /'SOURCE_VERIFICATION'/);
  assert.match(integrations, /\| 'SOURCE_VERIFICATION'/);
  assert.match(main, /SOURCE_VERIFICATION: '事实核验'/);
  assert.match(main, /SOURCE_VERIFICATION: \{ capability: 'TEXT'/);
});
