import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrator.js';

test('v17 -> v18 preserves schedules, child records, indexes and foreign keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-weekly-v18-'));
  const dbPath = path.join(dir, 'agent-hub.db');
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')));
      INSERT INTO schema_migrations(version,name) VALUES (17,'deploy_targets');
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE sessions(id TEXT PRIMARY KEY);
      CREATE TABLE jobs(id TEXT PRIMARY KEY);
      INSERT INTO users(id) VALUES (1);
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'USER' CHECK(kind IN ('USER','SYSTEM')),
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('ONCE','INTERVAL','DAILY')),
        schedule_value TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
        provider TEXT, model TEXT, execution_profile TEXT NOT NULL DEFAULT 'WORKSPACE',
        prompt TEXT, timeout_seconds INTEGER NOT NULL DEFAULT 300, enabled INTEGER NOT NULL DEFAULT 1,
        overlap_policy TEXT NOT NULL DEFAULT 'SKIP' CHECK(overlap_policy = 'SKIP'),
        next_run_at TEXT, last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        execution_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_schedules_due ON schedules(enabled,next_run_at);
      CREATE INDEX idx_schedules_user ON schedules(user_id,kind,created_at);
      CREATE TABLE schedule_runs(
        id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, job_id TEXT,
        status TEXT NOT NULL, FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
      );
      INSERT INTO schedules(id,user_id,name,schedule_type,schedule_value)
        VALUES ('s1',1,'Daily check','DAILY','08:30');
      INSERT INTO schedule_runs(id,schedule_id,status) VALUES ('r1','s1','COMPLETED');
    `);
    runMigrations(db, dbPath, path.join(dir, 'backups'));
    assert.equal(db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, 18);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schedule_runs WHERE schedule_id=?').get('s1').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schedules WHERE id=?').get('s1').n, 1);
    assert.doesNotThrow(() => db.prepare("INSERT INTO schedules(id,user_id,name,schedule_type,schedule_value) VALUES ('s2',1,'Weekly','WEEKLY','화,수,목,금 08:30')").run());
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('foreign_keys', {simple:true}), 1);
    const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_schedules_%'").all().map(r=>r.name).sort();
    assert.deepEqual(indices,['idx_schedules_due','idx_schedules_user']);
    runMigrations(db, dbPath, path.join(dir, 'backups'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=18').get().n, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
