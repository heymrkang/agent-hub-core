-- 005_memory.sql
-- Agent Hub Core V1 Global Memory Schema

CREATE TABLE IF NOT EXISTS memory_logs (
    id TEXT PRIMARY KEY, -- UUID
    action TEXT NOT NULL, -- INIT, UPDATE, APPEND, CLEAR
    source TEXT NOT NULL DEFAULT 'USER', -- USER, SYSTEM, AGENT, SCHEDULER
    previous_content TEXT,
    new_content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_logs_created ON memory_logs(created_at);
