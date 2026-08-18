-- 真实发布发生在公众号后台，复盘台账不能依赖本地发布任务或草稿版本。
ALTER TABLE publications
  ALTER COLUMN draft_version_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS publications_workspace_url_uidx
  ON publications (workspace_id, url)
  WHERE url <> '';
