import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.PHASE11_LIVE_E2E === '1';

test('V1 live lifecycle release gate is explicitly runtime-gated', { skip: !enabled }, () => {
  const required = [
    'PHASE11_TELEGRAM_OK',
    'PHASE11_CODEX_OK',
    'PHASE11_ANTIGRAVITY_OK',
    'PHASE11_ATTACHMENTS_OK',
    'PHASE11_HANDOFF_OK',
    'PHASE11_MEMORY_OK',
    'PHASE11_SCHEDULER_OK',
    'PHASE11_SSH_OK',
    'PHASE11_DOCKER_OK',
    'PHASE11_BACKUP_OK',
    'PHASE11_REDEPLOY_OK'
  ];

  const missing = required.filter((key) => process.env[key] !== '1');
  assert.deepEqual(missing, [], `Live V1 E2E evidence missing: ${missing.join(', ')}`);
});
