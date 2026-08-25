-- 004_attachments.sql
-- Agent Hub Core V1 Attachments Schema

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, -- UUID
    session_id TEXT NOT NULL,
    message_id TEXT,
    media_group_id TEXT,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL, -- IMAGE, DOCUMENT, AUDIO, VIDEO, OTHER
    mime_type TEXT,
    file_size INTEGER,
    local_path TEXT NOT NULL, -- 영속 저장 경로 (/data/uploads/...)
    sha256 TEXT,
    metadata TEXT, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_session_id ON attachments(session_id);
CREATE INDEX IF NOT EXISTS idx_attachments_media_group ON attachments(media_group_id);
