-- Phase 8 hardening: scheduler executions are one-shot system sessions.
-- Preserve old rows for debugging/retention, but never reuse them for future runs.
UPDATE sessions
SET status='DELETED',
    deleted_at=COALESCE(deleted_at, datetime('now')),
    updated_at=datetime('now')
WHERE is_system=1
  AND status='ARCHIVED';

UPDATE schedules
SET execution_session_id=NULL,
    updated_at=datetime('now')
WHERE kind='USER'
  AND execution_session_id IS NOT NULL;
