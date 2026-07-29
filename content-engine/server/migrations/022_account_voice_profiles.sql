CREATE TABLE account_voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  archetype_slug text NOT NULL CHECK (char_length(archetype_slug) BETWEEN 1 AND 80),
  identity_text text NOT NULL CHECK (char_length(identity_text) BETWEEN 1 AND 600),
  audience_text text NOT NULL CHECK (char_length(audience_text) BETWEEN 1 AND 600),
  reader_takeaway_text text NOT NULL CHECK (char_length(reader_takeaway_text) BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_voice_profiles_workspace_idx
  ON account_voice_profiles (workspace_id, status, updated_at DESC);

CREATE TABLE account_voice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE TABLE account_voice_defaults (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_voice_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('LINK', 'FILE', 'TEXT')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  source_url text,
  file_reference text,
  rule_summary text NOT NULL DEFAULT '' CHECK (char_length(rule_summary) <= 4000),
  confirmed_licensed boolean NOT NULL CHECK (confirmed_licensed),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_type = 'LINK' AND source_url IS NOT NULL AND file_reference IS NULL)
    OR (source_type = 'FILE' AND source_url IS NULL AND file_reference IS NOT NULL)
    OR (source_type = 'TEXT' AND source_url IS NULL AND file_reference IS NULL)
  )
);

CREATE TABLE account_voice_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE CASCADE,
  preference_text text NOT NULL CHECK (char_length(preference_text) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE writing_briefs
  ADD COLUMN account_voice_profile_id uuid REFERENCES account_voice_profiles(id) ON DELETE SET NULL,
  ADD COLUMN voice_offset text NOT NULL DEFAULT 'DEFAULT'
    CHECK (voice_offset IN ('DEFAULT', 'MORE_RESTRAINED', 'SHARPER', 'MORE_PERSONAL', 'MORE_NARRATIVE'));

CREATE INDEX writing_briefs_account_voice_idx
  ON writing_briefs (workspace_id, account_voice_profile_id)
  WHERE account_voice_profile_id IS NOT NULL;
