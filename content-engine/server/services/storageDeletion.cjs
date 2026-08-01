const { removeAssetFile: removeAssetFileFromDisk, removeWorkspaceDirectory: removeWorkspaceDirectoryFromDisk } = require('./assetStorage.cjs');

function createStorageDeletionService({ query, transaction, uploadRoot, removeAssetFile = (storageKey) => removeAssetFileFromDisk(uploadRoot, storageKey), removeWorkspaceDirectory = (workspaceId) => removeWorkspaceDirectoryFromDisk(uploadRoot, workspaceId) }) {
  async function claimDeletionJob(id) {
    const result = await query(`UPDATE storage_deletion_jobs
      SET status = 'RUNNING', started_at = COALESCE(started_at, now()), completed_at = NULL, error = NULL
      WHERE id = $1 AND status IN ('PENDING', 'FAILED')
      RETURNING *`, [id]);
    return result.rows[0] ?? null;
  }

  async function markDeletionFailed(id, error, queueJobId) {
    const message = (error instanceof Error ? error.message : String(error || '存储删除失败。')).slice(0, 2_000);
    await transaction(async (client) => {
      await client.query("UPDATE storage_deletion_jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [id, message]);
      if (queueJobId) await client.query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [queueJobId, message]);
    });
  }

  async function execute(requestedJob, queueJobId) {
    const job = await claimDeletionJob(requestedJob.id);
    if (!job) return { skipped: true };
    try {
      if (job.target_type === 'ASSET' || job.target_type === 'ORPHAN_FILE') await removeAssetFile(job.storage_key);
      else if (job.target_type === 'WORKSPACE') await removeWorkspaceDirectory(job.workspace_id);
      else throw new Error(`不支持的存储删除类型：${job.target_type}`);
      await transaction(async (client) => {
        if (job.target_type === 'ASSET') await client.query("DELETE FROM workspace_assets WHERE workspace_id = $1 AND id = $2 AND status = 'DELETING'", [job.workspace_id, job.target_id]);
        await client.query("UPDATE storage_deletion_jobs SET status = 'SUCCEEDED', error = NULL, completed_at = now() WHERE id = $1", [job.id]);
        if (queueJobId) await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [queueJobId, JSON.stringify({ deletionJobId: job.id })]);
        if (job.target_type === 'WORKSPACE') await client.query("DELETE FROM workspaces WHERE id = $1 AND status = 'DELETING'", [job.workspace_id]);
      });
      return { deletionJobId: job.id };
    } catch (error) {
      await markDeletionFailed(job.id, error, queueJobId);
      throw error;
    }
  }

  async function executeById({ workspaceId, deletionJobId, queueJobId }) {
    const result = await query('SELECT * FROM storage_deletion_jobs WHERE workspace_id = $1 AND id = $2', [workspaceId, deletionJobId]);
    if (!result.rows.length) throw new Error('没有找到存储删除任务。');
    return execute(result.rows[0], queueJobId);
  }

  async function recoverPendingDeletionJobs() {
    const pending = await query(`SELECT deletion.* FROM storage_deletion_jobs deletion
      WHERE deletion.status IN ('PENDING', 'FAILED')
        AND NOT EXISTS (
          SELECT 1 FROM jobs queued
          WHERE queued.workspace_id = deletion.workspace_id
            AND queued.job_type = 'STORAGE_DELETE'
            AND queued.status IN ('PENDING', 'RUNNING')
            AND queued.payload_json->>'deletionJobId' = deletion.id::text
        )
      ORDER BY deletion.created_at, deletion.id`);
    const jobs = [];
    for (const deletion of pending.rows) {
      const created = await query(`INSERT INTO jobs (workspace_id, job_type, payload_json)
        VALUES ($1, 'STORAGE_DELETE', $2) RETURNING *`, [deletion.workspace_id, JSON.stringify({ deletionJobId: deletion.id })]);
      jobs.push(created.rows[0]);
    }
    return jobs;
  }

  return { claimDeletionJob, markDeletionFailed, execute, executeById, recoverPendingDeletionJobs };
}

module.exports = { createStorageDeletionService };
