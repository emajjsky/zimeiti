CREATE TABLE content_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  input_kind text NOT NULL CHECK (input_kind IN ('URL', 'TEXT', 'ASSET')),
  source_type text NOT NULL CHECK (source_type IN ('GENERIC_WEB', 'WECHAT', 'ZHIHU', 'X', 'UPLOAD')),
  intent text NOT NULL CHECK (intent IN ('REFERENCE', 'AUTHOR_CONTENT', 'DISCOVERY', 'VOICE_SAMPLE')),
  usage_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(usage_json) = 'array'),
  source_url text,
  canonical_url text,
  source_asset_id uuid,
  title text NOT NULL DEFAULT '',
  author text,
  published_at timestamptz,
  stage text NOT NULL DEFAULT 'PENDING' CHECK (stage IN ('PENDING', 'FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING', 'READY', 'PARTIAL', 'NEEDS_USER_INPUT', 'FAILED', 'CANCELLED')),
  completeness text CHECK (completeness IS NULL OR completeness IN ('FULL', 'PARTIAL')),
  normalized_document_json jsonb,
  raw_snapshot_ref text,
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings_json) = 'array'),
  error_code text,
  error_message text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_asset_id) REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE content_ingestion_inputs (
  ingestion_id uuid PRIMARY KEY REFERENCES content_ingestions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  input_text text NOT NULL CHECK (char_length(input_text) <= 100000)
);

CREATE TABLE content_ingestion_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ingestion_id uuid NOT NULL REFERENCES content_ingestions(id) ON DELETE CASCADE,
  block_id text,
  source_url text NOT NULL,
  resolved_url text,
  alt_text text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  width integer,
  height integer,
  position integer,
  classification text NOT NULL DEFAULT 'UNKNOWN' CHECK (classification IN ('CONTENT', 'AVATAR', 'LOGO', 'AD', 'QR', 'DECORATION', 'UNKNOWN')),
  content_hash text,
  copyright_status text NOT NULL DEFAULT 'PENDING' CHECK (copyright_status IN ('PENDING', 'OWNED', 'LICENSED', 'OPEN_LICENSE', 'PROHIBITED')),
  selected boolean NOT NULL DEFAULT false,
  asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, ingestion_id, source_url),
  FOREIGN KEY (workspace_id, asset_id) REFERENCES workspace_assets(workspace_id, id) ON DELETE SET NULL
);

CREATE INDEX content_ingestions_workspace_updated_idx ON content_ingestions (workspace_id, updated_at DESC);
CREATE INDEX content_ingestions_project_idx ON content_ingestions (workspace_id, project_id, created_at DESC);
CREATE INDEX content_ingestion_media_ingestion_idx ON content_ingestion_media (workspace_id, ingestion_id, position);
