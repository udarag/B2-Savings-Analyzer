CREATE TABLE IF NOT EXISTS analyses (
  user_email text NOT NULL,
  id text NOT NULL,
  meta jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS analyses_user_created_idx
  ON analyses (user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS analyses_user_updated_idx
  ON analyses (user_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS analysis_parsed_bills (
  user_email text NOT NULL,
  analysis_id text NOT NULL,
  parsed jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, analysis_id),
  FOREIGN KEY (user_email, analysis_id)
    REFERENCES analyses (user_email, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_model_configs (
  user_email text NOT NULL,
  analysis_id text NOT NULL,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, analysis_id),
  FOREIGN KEY (user_email, analysis_id)
    REFERENCES analyses (user_email, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_snapshots (
  user_email text NOT NULL,
  analysis_id text NOT NULL,
  id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  trigger text NOT NULL,
  PRIMARY KEY (user_email, analysis_id, id),
  FOREIGN KEY (user_email, analysis_id)
    REFERENCES analyses (user_email, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS report_snapshots_latest_idx
  ON report_snapshots (user_email, analysis_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS analysis_uploads (
  id bigserial PRIMARY KEY,
  user_email text NOT NULL,
  analysis_id text NOT NULL,
  filename text NOT NULL,
  object_key text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_email, analysis_id, object_key),
  FOREIGN KEY (user_email, analysis_id)
    REFERENCES analyses (user_email, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analysis_uploads_latest_idx
  ON analysis_uploads (user_email, analysis_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_email text PRIMARY KEY,
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
