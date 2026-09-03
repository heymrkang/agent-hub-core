-- 016_mcp_servers.sql
-- Phase 19: Unified Master Store for Model Context Protocol (MCP) Servers

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command TEXT,
  args_json TEXT,
  url TEXT,
  env_keys_json TEXT,
  headers_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
