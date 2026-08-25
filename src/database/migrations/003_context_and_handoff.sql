-- 003_context_and_handoff.sql
-- Agent Hub Core V1 Context and Provider Handoff Schema

-- sessions 테이블에 rolling_summary 및 working_context 컬럼 추가 (필요시)
-- SQLite는 ALTER TABLE ADD COLUMN을 지원함
ALTER TABLE sessions ADD COLUMN rolling_summary TEXT;
ALTER TABLE sessions ADD COLUMN working_context TEXT;

-- Provider Native 세션 추적 테이블
CREATE TABLE IF NOT EXISTS provider_sessions (
    id TEXT PRIMARY KEY, -- UUID
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    native_session_ref TEXT, -- CLI 측 세션 UUID 또는 참조값
    last_synced_message_id TEXT, -- 마지막 동기화된 Canonical Message ID
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_sessions_session ON provider_sessions(session_id, provider);

-- Provider Handoff 이력 테이블
CREATE TABLE IF NOT EXISTS provider_handoffs (
    id TEXT PRIMARY KEY, -- UUID
    session_id TEXT NOT NULL,
    from_provider TEXT NOT NULL,
    to_provider TEXT NOT NULL,
    handoff_payload TEXT, -- Handoff 패키지 요약/메타
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_provider_handoffs_session ON provider_handoffs(session_id);
