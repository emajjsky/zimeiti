CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE workspace_snapshots (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credential_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_secret bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE intelligence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('RSS', 'OFFICIAL_API', 'AUTHORIZED_API')),
  url text NOT NULL,
  category text NOT NULL,
  include_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclude_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  language text NOT NULL DEFAULT 'ALL' CHECK (language IN ('ALL', 'ZH', 'EN')),
  enabled boolean NOT NULL DEFAULT true,
  refresh_minutes integer NOT NULL DEFAULT 60 CHECK (refresh_minutes >= 5),
  trust text NOT NULL DEFAULT '待核验',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intelligence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES intelligence_sources(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  category text NOT NULL,
  source_name text NOT NULL,
  canonical_url text,
  language text NOT NULL DEFAULT 'other',
  capture_method text NOT NULL CHECK (capture_method IN ('RSS', 'MANUAL_LINK', 'SEARCH')),
  trust text NOT NULL DEFAULT '待核验',
  heat integer NOT NULL DEFAULT 0 CHECK (heat BETWEEN 0 AND 100),
  published_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, source_name, canonical_url)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE api_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text,
  operation text NOT NULL,
  status text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intelligence_items_workspace_created_idx ON intelligence_items (workspace_id, created_at DESC);
CREATE INDEX jobs_workspace_created_idx ON jobs (workspace_id, created_at DESC);
CREATE INDEX api_usage_workspace_created_idx ON api_usage_logs (workspace_id, created_at DESC);
