import assert from 'node:assert/strict';
import test from 'node:test';

const enabled = process.env.PHASE17_LIVE_E2E === '1';

test('Phase 17 실서버 공동 검증 evidence gate', { skip: !enabled }, () => {
  const required = [
    'PHASE17_TELEGRAM_PREVIEW_OK',
    'PHASE17_CLOUDFLARE_ACCESS_OK',
    'PHASE17_OPENAPI_OK',
    'PHASE17_AUTHENTICATED_CRUD_OK',
    'PHASE17_MARIADB_PERSISTENCE_OK',
    'PHASE17_SECRET_REDACTION_OK',
    'PHASE17_RESTART_OK',
    'PHASE17_CLEANUP_OK',
    'PHASE17_WEB_REGRESSION_OK'
  ];

  const missing = required.filter((key) => process.env[key] !== '1');
  assert.deepEqual(missing, [], `Phase 17 live E2E evidence missing: ${missing.join(', ')}`);
});
