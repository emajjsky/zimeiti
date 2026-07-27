CREATE TABLE project_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('IDEA', 'DRAFT', 'NOTE', 'TRANSCRIPT')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  scope text NOT NULL CHECK (scope IN ('PROJECT', 'RESEARCH', 'WRITING', 'IMAGING')),
  platforms_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(platforms_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_inputs_project_idx
  ON project_inputs (workspace_id, project_id, updated_at DESC);

CREATE TABLE project_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('LINK', 'FILE')),
  role text NOT NULL CHECK (role IN ('FACT', 'OPINION', 'STRUCTURE', 'VOICE', 'HOOK', 'VISUAL', 'NEGATIVE')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  url text,
  storage_key text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  scope text NOT NULL CHECK (scope IN ('PROJECT', 'RESEARCH', 'WRITING', 'IMAGING')),
  platforms_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(platforms_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_type = 'LINK' AND url IS NOT NULL AND storage_key IS NULL)
    OR
    (source_type = 'FILE' AND url IS NULL AND storage_key IS NOT NULL AND original_filename IS NOT NULL AND mime_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)
  )
);

CREATE INDEX project_references_project_idx
  ON project_references (workspace_id, project_id, updated_at DESC);

CREATE INDEX project_references_hash_idx
  ON project_references (workspace_id, project_id, sha256)
  WHERE sha256 IS NOT NULL;
