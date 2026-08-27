-- 011_operations.sql
-- Phase 10 Operations / Backup / Logging metadata

CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- CORE, FULL
    path TEXT NOT NULL,
    size_bytes INTEGER,
    status TEXT NOT NULL DEFAULT 'COMPLETED', -- RUNNING, COMPLETED, FAILED
    metadata TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(type);

CREATE TABLE IF NOT EXISTS system_job_runs (
    id TEXT PRIMARY KEY,
    job_name TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_system_job_runs_name ON system_job_runs(job_name, started_at);

CREATE TABLE IF NOT EXISTS structured_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    event TEXT NOT NULL,
    session_id TEXT,
    provider TEXT,
    model TEXT,
    duration_ms INTEGER,
    error_code TEXT,
    detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_structured_logs_timestamp ON structured_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_structured_logs_category ON structured_logs(category, timestamp);
