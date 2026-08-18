ALTER TABLE metric_snapshots
  ALTER COLUMN read_count DROP DEFAULT,
  ALTER COLUMN read_count DROP NOT NULL,
  ALTER COLUMN like_count DROP DEFAULT,
  ALTER COLUMN like_count DROP NOT NULL,
  ALTER COLUMN share_count DROP DEFAULT,
  ALTER COLUMN share_count DROP NOT NULL,
  ALTER COLUMN favorite_count DROP DEFAULT,
  ALTER COLUMN favorite_count DROP NOT NULL,
  ALTER COLUMN comment_count DROP DEFAULT,
  ALTER COLUMN comment_count DROP NOT NULL,
  ALTER COLUMN follower_delta DROP DEFAULT,
  ALTER COLUMN follower_delta DROP NOT NULL;

ALTER TABLE metric_snapshots
  ADD COLUMN exposure_count integer CHECK (exposure_count IS NULL OR exposure_count >= 0),
  ADD COLUMN play_count integer CHECK (play_count IS NULL OR play_count >= 0),
  ADD COLUMN checkpoint text NOT NULL DEFAULT 'CUSTOM' CHECK (checkpoint IN ('D1', 'D3', 'D7', 'CUSTOM'));
