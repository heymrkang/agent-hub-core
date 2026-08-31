import test from 'node:test';
import assert from 'node:assert/strict';
import { serverRegistrationHelp } from '../../src/telegram/commands/servers.js';

test('/server 도움말은 Key 배치부터 등록 및 연결 테스트까지 안내한다', () => {
  const help = serverRegistrationHelp();

  assert.match(help, /\/data\/ssh\/keys/);
  assert.match(help, /\/server keys/);
  assert.match(help, /\/server add <alias> <host> <user> <keyfile> \[port\]/);
  assert.match(help, /\/server add dev 192\.168\.0\.10 ubuntu dev\.key 22/);
  assert.match(help, /\/server test dev/);
});
