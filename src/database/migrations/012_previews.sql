-- 012_previews.sql
-- Phase 13 Preview Registry

CREATE TABLE IF NOT EXISTS previews (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    project_name TEXT NOT NULL,
    slug TEXT NOT NULL,
    public_hostname TEXT NOT NULL UNIQUE,
    public_url TEXT NOT NULL UNIQUE,
    container_id TEXT UNIQUE,
    command TEXT,
    package_manager TEXT,
    port INTEGER,
    status TEXT NOT NULL DEFAULT 'STARTING'
        CHECK (status IN ('STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED', 'EXPIRED')),
    started_at TEXT,
    last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
    stopped_at TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CHECK (port IS NULL OR (port >= 1 AND port <= 65535))
);

CREATE INDEX IF NOT EXISTS idx_previews_session_id ON previews(session_id);
CREATE INDEX IF NOT EXISTS idx_previews_status ON previews(status);
CREATE INDEX IF NOT EXISTS idx_previews_last_activity ON previews(last_activity_at);

-- A workspace may have historical previews, but only one live lifecycle at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_previews_one_active_workspace
ON previews(workspace_path)
WHERE status IN ('STARTING', 'RUNNING', 'STOPPING');
