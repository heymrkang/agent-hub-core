-- v18: extend schedules.schedule_type CHECK to WEEKLY.
-- The migrator disables foreign_keys outside its transaction for this table rebuild.
CREATE TABLE schedules_v18 (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'USER' CHECK(kind IN ('USER','SYSTEM')),
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('ONCE','INTERVAL','DAILY','WEEKLY')),
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
  execution_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO schedules_v18 SELECT * FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_v18 RENAME TO schedules;
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);
CREATE INDEX idx_schedules_user ON schedules(user_id, kind, created_at);
