import assert from 'node:assert/strict';
import test from 'node:test';
import analysis from '../server/services/intelligence-analysis.cjs';

function templateQueryMemory() {
  const rows = [];
  return {
    async query(sql, params) {
      if (sql.includes('SELECT') && sql.includes('prompt_template_versions')) {
        const matches = rows.filter((item) => item.workspace_id === params[0] && item.scope === params[1]).sort((left, right) => right.version - left.version);
        return { rowCount: matches.length, rows: matches.slice(0, 1) };
      }
      if (sql.includes('INSERT INTO prompt_template_versions')) {
        const row = { id: `template-${rows.length + 1}`, workspace_id: params[0], scope: params[1], version: params[2], body: params[3], source: params[4], created_at: new Date().toISOString() };
        rows.push(row);
        return { rowCount: 1, rows: [row] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('恢复默认模板创建新版本而不覆盖自定义历史', async () => {
  const memory = templateQueryMemory();
  const store = analysis.createTemplateStore(memory);
  const first = await store.save('workspace-1', 'INTELLIGENCE_ANALYSIS', '关注 {{title}} 的实用价值。');
  const reset = await store.reset('workspace-1', 'INTELLIGENCE_ANALYSIS');

  assert.equal(first.version, 1);
  assert.equal(first.source, 'CUSTOM');
  assert.equal(reset.version, 2);
  assert.equal(reset.source, 'DEFAULT');
  assert.match(reset.body, /热点分析/);
});
