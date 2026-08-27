-- 009_infrastructure.sql
-- Phase 9 SSH host registry

CREATE TABLE IF NOT EXISTS ssh_hosts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    alias TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    identity_file TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, alias),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ssh_hosts_user_enabled ON ssh_hosts(user_id, enabled);
