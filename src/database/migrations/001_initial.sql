-- 001_initial.sql
-- Agent Hub Core V1 Initial Schema

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, -- Telegram Numeric User ID
    role TEXT NOT NULL DEFAULT 'OWNER',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, -- UUID
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '새 채팅',
    title_locked INTEGER NOT NULL DEFAULT 0,
    active_provider TEXT NOT NULL DEFAULT 'codex',
    active_model TEXT,
    execution_profile TEXT NOT NULL DEFAULT 'WORKSPACE',
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED, DELETED
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, -- UUID
    session_id TEXT NOT NULL,
    role TEXT NOT NULL, -- user, assistant, system
    text TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
