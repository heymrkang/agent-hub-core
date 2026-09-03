-- 017_deploy_targets.sql
-- Phase 20: Coolify Deploy Targets Management

CREATE TABLE IF NOT EXISTS deploy_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  webhook_url TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deploy_targets_name ON deploy_targets(name);
