ALTER TABLE credential_vault
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS model_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('DASHSCOPE', 'SILICONFLOW', 'VOLCENGINE_ARK', 'KIMI', 'ZHIPU', 'OPENAI', 'OPENAI_COMPATIBLE')),
  label text NOT NULL,
  base_url text NOT NULL,
  encrypted_secret bytea NOT NULL,
  status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED', 'READY', 'ERROR')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_connections_workspace_updated_idx ON model_connections (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS model_catalog (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  item_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

ALTER TABLE agent_model_policies DROP CONSTRAINT IF EXISTS agent_model_policies_provider_check;
ALTER TABLE agent_model_policies
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES model_connections(id) ON DELETE SET NULL;
ALTER TABLE agent_model_policies
  ADD CONSTRAINT agent_model_policies_provider_check CHECK (provider IN ('BAILIAN_CLI', 'EXTERNAL_API'));
