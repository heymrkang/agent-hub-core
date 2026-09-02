import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecrets } from '../../src/utils/redact.js';

test('quoted env, JWT, private key와 DB URL을 로그에서 제거한다', () => {
  const input = [
    'PASSWORD="quoted secret value"',
    'CLIENT_SECRET=plain-secret',
    'jwt=eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    'DATABASE_URL=mariadb://user:password@db.internal/app',
    '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----'
  ].join('\n');
  const output = redactSecrets(input);
  assert.doesNotMatch(output, /quoted secret value|plain-secret|eyJabcdefghijk|db\.internal|private-material/);
  assert.match(output, /PASSWORD=\[REDACTED\]/);
});
