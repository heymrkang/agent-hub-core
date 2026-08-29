import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePreviewStartArgs } from '../../src/telegram/commands/preview.js';

test('Preview start 인자에서 절대경로와 수동 port를 파싱한다', () => {
  assert.deepEqual(parsePreviewStartArgs('/home/dev/workspace/my app --port 4173'), {
    workspacePath: '/home/dev/workspace/my app',
    manualPort: 4173
  });
  assert.deepEqual(parsePreviewStartArgs('/home/dev/workspace/app'), {
    workspacePath: '/home/dev/workspace/app',
    manualPort: null
  });
});

test('Preview start는 상대경로와 잘못된 port를 거부한다', () => {
  assert.throws(() => parsePreviewStartArgs('workspace/app'), /절대경로/);
  assert.throws(() => parsePreviewStartArgs('/home/dev/app --port 70000'), /1~65535/);
  assert.throws(() => parsePreviewStartArgs(''), /사용법/);
});
