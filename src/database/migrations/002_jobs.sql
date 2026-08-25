-- 002_jobs.sql
-- Agent Hub Core V1 Job Runtime Schema

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, -- UUID
    session_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'CHAT', -- CHAT, SCHEDULER, SYSTEM
    provider TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED, INTERRUPTED
    exit_code INTEGER,
    error_category TEXT, -- PROVIDER_AUTH, PROVIDER_EXEC, NETWORK, TIMEOUT, CANCELLED, AGENT_HUB_RESTART, INTERNAL
    error_message TEXT,
    queued_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ended_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
