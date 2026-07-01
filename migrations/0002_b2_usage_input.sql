CREATE TABLE IF NOT EXISTS analysis_b2_usage (
  user_email text NOT NULL,
  analysis_id text NOT NULL,
  usage jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, analysis_id),
  FOREIGN KEY (user_email, analysis_id)
    REFERENCES analyses (user_email, id)
    ON DELETE CASCADE
);
