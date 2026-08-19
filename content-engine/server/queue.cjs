const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config.cjs');

let connection;
let queue;
const RETRYABLE_JOB_TYPES = new Set([
  'BAILIAN_TEXT',
  'INTELLIGENCE_ANALYSIS',
  'PROJECT_RESEARCH_PLAN',
  'PROJECT_RESEARCH_SOURCES',
  'SOURCE_VERIFICATION',
]);

function getQueue() {
  if (!connection) connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('content-engine', { connection });
  return queue;
}

async function enqueue(job) {
  return getQueue().add(job.job_type, { jobId: job.id, workspaceId: job.workspace_id, payload: job.payload_json }, queueJobOptions(job));
}

function queueJobOptions(job) {
  const base = { jobId: job.id, removeOnComplete: 100, removeOnFail: 200 };
  if (!RETRYABLE_JOB_TYPES.has(job.job_type)) return base;
  return { ...base, attempts: 3, backoff: { type: 'exponential', delay: 1_500 } };
}

function isFinalQueueAttempt(queueJob) {
  const attempts = Math.max(1, Number(queueJob?.opts?.attempts ?? 1));
  return Number(queueJob?.attemptsMade ?? 0) + 1 >= attempts;
}

module.exports = { getQueue, enqueue, queueJobOptions, isFinalQueueAttempt };
