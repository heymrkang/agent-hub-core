import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const fixture = new URL('../fixtures/init-database-child.js', import.meta.url);

test('startup aborts when DB schema version is newer than application migrations', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-db-newer-'));
  const dbPath = path.join(dataDir, 'agent-hub.db');
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(999, 'future_schema');
  } finally {
    db.close();
  }

  try {
    const result = spawnSync(process.execPath, [fixture.pathname], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /DB 스키마 버전\(v999\).*애플리케이션 지원 버전/);
    assert.doesNotMatch(result.stdout, /STARTED/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
