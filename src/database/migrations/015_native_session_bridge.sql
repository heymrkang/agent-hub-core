-- 015_native_session_bridge.sql
-- V1 -> V2 Native Session Bridge: provider native-session lifecycle metadata

ALTER TABLE provider_sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'UNBOUND';
ALTER TABLE provider_sessions ADD COLUMN bound_at TEXT;
ALTER TABLE provider_sessions ADD COLUMN last_verified_at TEXT;
ALTER TABLE provider_sessions ADD COLUMN last_error TEXT;
ALTER TABLE provider_sessions ADD COLUMN metadata_json TEXT;

-- Existing refs are preserved and promoted to READY. Rows without refs remain UNBOUND.
UPDATE provider_sessions
SET state = CASE
      WHEN native_session_ref IS NOT NULL AND trim(native_session_ref) <> '' THEN 'READY'
      ELSE 'UNBOUND'
    END,
    bound_at = CASE
      WHEN native_session_ref IS NOT NULL AND trim(native_session_ref) <> '' THEN COALESCE(bound_at, updated_at, created_at)
      ELSE bound_at
    END;

-- A logical session may have at most one mapping per provider.
-- If historical duplicate rows exist, fail migration visibly rather than silently deleting or guessing which ref wins.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_sessions_session_provider
ON provider_sessions(session_id, provider);
