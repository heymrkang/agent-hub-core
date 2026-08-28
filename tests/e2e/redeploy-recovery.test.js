import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const fixture = new URL('../fixtures/redeploy-recovery-child.js', import.meta.url);

test('persisted V1 state survives process restart and RUNNING job becomes INTERRUPTED', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-redeploy-'));
  try {
    execFileSync(process.execPath, [fixture.pathname, 'seed'], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    });
    const output = execFileSync(process.execPath, [fixture.pathname, 'verify'], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    });
    const jsonStart = output.lastIndexOf('{"session"');
    assert.notEqual(jsonStart, -1, `fixture output did not contain JSON: ${output}`);
    const result = JSON.parse(output.slice(jsonStart));

    assert.equal(result.session, 'Persistent Session');
    assert.equal(result.message, 'persist-me');
    assert.equal(result.memory, 'persistent-memory');
    assert.equal(result.schedule, 'persistent-schedule');
    assert.equal(result.ssh, 'dev');
    assert.equal(result.job.status, 'INTERRUPTED');
    assert.equal(result.job.error_category, 'AGENT_HUB_RESTART');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
