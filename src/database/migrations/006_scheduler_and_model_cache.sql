CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'USER' CHECK(kind IN ('USER','SYSTEM')),
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('ONCE','INTERVAL','DAILY')),
  schedule_value TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  provider TEXT,
  model TEXT,
  execution_profile TEXT NOT NULL DEFAULT 'WORKSPACE',
  prompt TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1,
  overlap_policy TEXT NOT NULL DEFAULT 'SKIP' CHECK(overlap_policy = 'SKIP'),
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id, kind, created_at);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','SKIPPED','MISSED','CANCELLED')),
  started_at TEXT,
  finished_at TEXT,
  output_text TEXT,
  output_summary TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_models (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(provider, model_id)
);

CREATE TABLE IF NOT EXISTS provider_model_cache (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'EMPTY' CHECK(status IN ('FRESH','STALE','EMPTY','REFRESHING')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
