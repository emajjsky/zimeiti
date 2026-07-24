const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config.cjs');
const { query } = require('./db.cjs');
const { decrypt } = require('./crypto.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');
const { listAvailableSkills, plannerSkillView } = require('./agent/skillRegistry.cjs');
const { parsePlan } = require('./agent/planValidation.cjs');

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

async function processJob(queueJob) {
  const { jobId, workspaceId, payload } = queueJob.data;
  await query('UPDATE jobs SET status = $1, started_at = now() WHERE id = $2 AND workspace_id = $3', ['RUNNING', jobId, workspaceId]);
  try {
    if (queueJob.name === 'AGENT_PLAN') return await generateAgentPlan({ jobId, workspaceId, planId: payload.planId });
    if (queueJob.name !== 'BAILIAN_TEXT') throw new Error(`暂不支持的任务类型：${queueJob.name}`);
    const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
    if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
    const output = await runBailianCli(['text', 'chat', '--model', payload.model, '--system', payload.system, '--message', payload.message, '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
    await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ output }), jobId]);
    return { jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务失败。';
    if (queueJob.name === 'AGENT_PLAN' && payload.planId) await query('UPDATE agent_plans SET status = $1, error = $2, updated_at = now() WHERE id = $3 AND workspace_id = $4', ['FAILED', message.slice(0, 2_000), payload.planId, workspaceId]);
    await query('UPDATE jobs SET status = $1, error = $2, completed_at = now() WHERE id = $3', ['FAILED', message.slice(0, 2_000), jobId]);
    throw error;
  }
}

async function generateAgentPlan({ jobId, workspaceId, planId }) {
  const planRow = await query('SELECT request_text, context_json FROM agent_plans WHERE id = $1 AND workspace_id = $2', [planId, workspaceId]);
  if (!planRow.rowCount) throw new Error('未找到 Agent 计划。');
  const policyRow = await query('SELECT model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2 AND provider = $3', [workspaceId, 'AGENT_PLANNER', 'BAILIAN_CLI']);
  if (!policyRow.rowCount) throw new Error('请先为核心 Agent 配置规划模型。');
  const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
  if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
  const skills = await listAvailableSkills(workspaceId);
  const system = `你是内容运营核心 Agent。你只负责生成受限任务计划，不直接执行。只可从以下 Skill 中选择，不能编造 Skill、URL、工具或发布动作。必须仅返回 JSON：{"goal":"","contextSummary":"","estimatedCost":"","risks":[""],"steps":[{"skillVersionId":"","purpose":"","inputs":[""]}]}。可用 Skill：${JSON.stringify(plannerSkillView(skills))}`;
  const prompt = JSON.stringify({ request: planRow.rows[0].request_text, context: planRow.rows[0].context_json });
  const output = await runBailianCli(['text', 'chat', '--model', policyRow.rows[0].model, '--system', system, '--message', prompt, '--max-tokens', '1200', '--temperature', '0.2', '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
  const payload = JSON.parse(output);
  const content = payload?.choices?.[0]?.message?.content ?? payload?.content;
  if (typeof content !== 'string') throw new Error('核心 Agent 没有返回计划内容。');
  const plan = parsePlan(content, skills);
  await query('UPDATE agent_plans SET status = $1, plan_json = $2, planner_model = $3, updated_at = now() WHERE id = $4', ['WAITING_CONFIRMATION', JSON.stringify(plan), policyRow.rows[0].model, planId]);
  await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ planId }), jobId]);
  return { planId };
}

const worker = new Worker('content-engine', processJob, { connection });
worker.on('ready', () => console.log('Content Engine Worker 已启动'));
worker.on('failed', (job, error) => console.error(`任务 ${job?.id} 失败：${error.message}`));

async function close() { await worker.close(); await connection.quit(); }
process.on('SIGINT', () => void close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void close().finally(() => process.exit(0)));
