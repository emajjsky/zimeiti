CREATE TABLE publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id uuid,
  account_id uuid NOT NULL,
  draft_version_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  title text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'ARCHIVED')),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id)
    REFERENCES platform_draft_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES channel_accounts(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, draft_version_id)
    REFERENCES content_draft_versions(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, task_id)
);

CREATE TABLE metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'OFFICIAL_API')),
  read_count integer NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  share_count integer NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  favorite_count integer NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
  comment_count integer NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  follower_delta integer NOT NULL DEFAULT 0,
  raw_json jsonb CHECK (raw_json IS NULL OR jsonb_typeof(raw_json) = 'object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, publication_id)
    REFERENCES publications(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE TABLE retrospectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL,
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 8000),
  highlights_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(highlights_json) = 'array'),
  issues_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues_json) = 'array'),
  next_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(next_actions_json) = 'array'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, publication_id)
    REFERENCES publications(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, publication_id)
);

CREATE INDEX publications_workspace_idx
  ON publications (workspace_id, published_at DESC, updated_at DESC);

CREATE INDEX metric_snapshots_publication_idx
  ON metric_snapshots (workspace_id, publication_id, captured_at DESC);

CREATE INDEX retrospectives_workspace_idx
  ON retrospectives (workspace_id, updated_at DESC);
