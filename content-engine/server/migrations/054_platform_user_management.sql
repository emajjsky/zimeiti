ALTER TABLE users
  ADD COLUMN platform_role text NOT NULL DEFAULT 'USER'
    CHECK (platform_role IN ('SUPER_ADMIN', 'USER')),
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE registration_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  code_hint text NOT NULL,
  label text NOT NULL DEFAULT '',
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);

