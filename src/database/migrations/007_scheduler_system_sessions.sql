ALTER TABLE sessions ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN execution_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_system ON sessions(is_system, status);
