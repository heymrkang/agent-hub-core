import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewFailureDiagnostic } from '../../src/preview/failure-diagnostics.js';

test('실패 진단에 단계·명령·exit·수정 힌트를 넣고 secret을 제거한다', () => {
  const error = Object.assign(new Error('readiness timeout token=secret-value'), { code: 'HTTP_READINESS_TIMEOUT' });
  const diagnostic = createPreviewFailureDiagnostic({
    error,
    stage: 'http_readiness',
    command: { executable: 'npm', args: ['run', 'start:dev'] },
    state: { running: false, exitCode: 1 },
    logs: '\u001b[31mDATABASE_URL=mariadb://fixture:fixture-password@db/dev\u001b[0m'
  });
  assert.match(diagnostic, /HTTP_READINESS_TIMEOUT/);
  assert.match(diagnostic, /단계: http_readiness/);
  assert.match(diagnostic, /npm.*start:dev/);
  assert.match(diagnostic, /exited \(1\)/);
  assert.match(diagnostic, /0\.0\.0\.0/);
  assert.doesNotMatch(diagnostic, /secret-value|fixture-password/);
  assert.match(diagnostic, /\[REDACTED\]/);
});
