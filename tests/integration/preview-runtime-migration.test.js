import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const migrationDir = path.resolve('src/database/migrations');

function applyMigrations(db, from, to) {
  const files = fs.readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => {
      const version = Number.parseInt(name, 10);
      return version >= from && version <= to;
    });
  for (const filename of files) db.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
}

test('migration 014는 기존 Preview를 WEB 계약으로 안전하게 보정한다', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    applyMigrations(db, 1, 13);
    db.prepare('INSERT INTO users(id) VALUES(1)').run();
    db.prepare("INSERT INTO sessions(id,user_id,title) VALUES('session-1',1,'legacy')").run();
    db.prepare(`
      INSERT INTO previews(
        id,session_id,workspace_path,project_name,slug,public_hostname,public_url,status
      ) VALUES(
        'legacy-preview','session-1','/home/dev/legacy','legacy','legacy',
        'preview-legacy.12190529.xyz','https://preview-legacy.12190529.xyz','STOPPED'
      )
    `).run();

    applyMigrations(db, 14, 14);

    const preview = db.prepare('SELECT * FROM previews WHERE id=?').get('legacy-preview');
    assert.equal(preview.runtime_type, 'WEB');
    assert.equal(preview.framework, null);
    assert.equal(preview.openapi_ui_path, null);
    assert.equal(preview.openapi_json_path, null);
    assert.equal(preview.health_path, null);
    assert.equal(preview.access_verified, 0);
    assert.throws(
      () => db.prepare("UPDATE previews SET runtime_type='INVALID' WHERE id='legacy-preview'").run(),
      /CHECK constraint failed/
    );
  } finally {
    db.close();
  }
});
