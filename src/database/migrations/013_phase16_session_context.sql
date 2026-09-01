-- Phase 16 canonical compact state and per-session reasoning preference.
ALTER TABLE sessions ADD COLUMN compact_cursor_message_id TEXT;
ALTER TABLE sessions ADD COLUMN last_compacted_at TEXT;
ALTER TABLE sessions ADD COLUMN compact_before_chars INTEGER;
ALTER TABLE sessions ADD COLUMN compact_after_chars INTEGER;
ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'default';
