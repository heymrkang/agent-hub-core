import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const fixture = new URL('../fixtures/core-backup-restore-child.js', import.meta.url);

test('core backup restores DB integrity and representative V1 state into an empty target', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-backup-'));
  try {
    const output = execFileSync(process.execPath, [fixture.pathname], {
      env: { ...process.env, DATA_DIR: dataDir, WORKSPACE_DIR: path.join(dataDir, 'workspace') },
      encoding: 'utf8'
    });
    const jsonStart = output.lastIndexOf('{"quick"');
    assert.notEqual(jsonStart, -1, `fixture output did not contain JSON: ${output}`);
    const result = JSON.parse(output.slice(jsonStart));

    assert.equal(result.quick, 'ok');
    assert.equal(result.session, 'Backup Session');
    assert.equal(result.setting, 'settings-ok');
    assert.equal(result.memory, 'memory-ok');
    assert.equal(result.schedule, 'schedule-ok');
    assert.equal(result.backupExists, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
