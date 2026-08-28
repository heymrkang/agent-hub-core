import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const fixture = new URL('../fixtures/restart-recovery-child.js', import.meta.url);

test('restart recovery marks RUNNING jobs INTERRUPTED and leaves QUEUED jobs untouched', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-restart-'));
  try {
    const output = execFileSync(process.execPath, [fixture.pathname], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    });
    const jsonStart = output.lastIndexOf('{"running"');
    assert.notEqual(jsonStart, -1, `fixture output did not contain JSON: ${output}`);
    const result = JSON.parse(output.slice(jsonStart));

    assert.equal(result.running.status, 'INTERRUPTED');
    assert.equal(result.running.error_category, 'AGENT_HUB_RESTART');
    assert.match(result.running.error_message, /서버 재시작/);
    assert.ok(result.running.ended_at);
    assert.equal(result.queued.status, 'QUEUED');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
