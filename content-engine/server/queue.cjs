const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config.cjs');

let connection;
let queue;

function getQueue() {
  if (!connection) connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('content-engine', { connection });
  return queue;
}

async function enqueue(job) {
  return getQueue().add(job.job_type, { jobId: job.id, workspaceId: job.workspace_id, payload: job.payload_json }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 200 });
}

module.exports = { getQueue, enqueue };
