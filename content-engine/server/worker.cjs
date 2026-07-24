const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config.cjs');
const { query } = require('./db.cjs');
const { decrypt } = require('./crypto.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

async function processJob(queueJob) {
  const { jobId, workspaceId, payload } = queueJob.data;
  await query('UPDATE jobs SET status = $1, started_at = now() WHERE id = $2 AND workspace_id = $3', ['RUNNING', jobId, workspaceId]);
  try {
    if (queueJob.name !== 'BAILIAN_TEXT') throw new Error(`暂不支持的任务类型：${queueJob.name}`);
    const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
    if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
    const output = await runBailianCli(['text', 'chat', '--model', payload.model, '--system', payload.system, '--message', payload.message, '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
    await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ output }), jobId]);
    return { jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务失败。';
    await query('UPDATE jobs SET status = $1, error = $2, completed_at = now() WHERE id = $3', ['FAILED', message.slice(0, 2_000), jobId]);
    throw error;
  }
}

const worker = new Worker('content-engine', processJob, { connection });
worker.on('ready', () => console.log('Content Engine Worker 已启动'));
worker.on('failed', (job, error) => console.error(`任务 ${job?.id} 失败：${error.message}`));

async function close() { await worker.close(); await connection.quit(); }
process.on('SIGINT', () => void close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void close().finally(() => process.exit(0)));
