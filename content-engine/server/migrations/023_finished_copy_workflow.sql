-- 旧流程生成的 NEEDS_REVIEW 正文候选不能继续占用当前修改入口。
-- 内容和运行记录完整保留，只将候选退出当前工作状态。
UPDATE project_artifacts
SET status = 'REJECTED', updated_at = now()
WHERE artifact_type = 'PLATFORM_COPY'
  AND status = 'CANDIDATE'
  AND metadata_json->'payload'->'qualityReview'->>'status' = 'NEEDS_REVIEW';
