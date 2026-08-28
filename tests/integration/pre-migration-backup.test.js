import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createPreMigrationBackup } from '../../src/database/pre-migration-backup.js';

test('pre-migration snapshot contains committed WAL data and passes quick_check', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-migration-'));
  const dbPath = path.join(root, 'agent-hub.db');
  const backupDir = path.join(root, 'backups');
  const db = new Database(dbPath);

  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO sample (value) VALUES (?)').run('committed-in-wal');

    const snapshotPath = createPreMigrationBackup(db, dbPath, backupDir);
    assert.ok(snapshotPath);
    assert.equal(fs.existsSync(snapshotPath), true);

    const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(snapshot.prepare('SELECT value FROM sample WHERE id = 1').get().value, 'committed-in-wal');
      assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      snapshot.close();
    }
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
