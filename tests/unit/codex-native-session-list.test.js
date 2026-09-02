import test from 'node:test';
import assert from 'node:assert/strict';

import { CODEX_NATIVE_SESSION_SOURCE_KINDS, normalizeCodexThreadList } from '../../src/providers/codex/native-session-list.js';
import { CodexAdapter } from '../../src/providers/codex/codex-adapter.js';

test('Codex thread/list 결과를 /sessions용 native session shape로 정규화한다', () => {
  const result = normalizeCodexThreadList({
    data: [{
      id: '019-native-thread',
      sessionId: 'session-tree-a',
      name: null,
      preview: 'Phase 17 작업 계속 진행',
      cwd: '/home/dev',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      source: 'exec',
      status: { type: 'idle' },
      createdAt: 1788340000,
      updatedAt: 1788340600,
      ephemeral: false
    }],
    nextCursor: 'cursor-2'
  });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].nativeSessionRef, '019-native-thread');
  assert.equal(result.sessions[0].title, 'Phase 17 작업 계속 진행');
  assert.equal(result.sessions[0].model, 'gpt-5.6-sol');
  assert.equal(result.sessions[0].reasoningEffort, 'medium');
  assert.equal(result.sessions[0].source, 'exec');
  assert.match(result.sessions[0].updatedAt, /^2026-/);
  assert.equal(result.nextCursor, 'cursor-2');
});

test('Codex native list source는 interactive와 non-interactive primary sessions를 함께 요청한다', () => {
  assert.deepEqual(CODEX_NATIVE_SESSION_SOURCE_KINDS, ['cli', 'vscode', 'exec', 'appServer']);
});

test('CodexAdapter.listNativeSessions는 app-server thread/list 결과만 정규화한다', async () => {
  const adapter = new CodexAdapter();
  adapter.queryAppServerThreads = async (options) => {
    assert.deepEqual(options, { cursor: 'abc', limit: 20 });
    return {
      data: [{ id: 'thread-a', preview: 'hello', createdAt: 100, updatedAt: 200, source: 'exec', ephemeral: false }],
      nextCursor: null
    };
  };
  const result = await adapter.listNativeSessions({ cursor: 'abc', limit: 20 });
  assert.equal(result.sessions[0].nativeSessionRef, 'thread-a');
  assert.equal(result.sessions[0].title, 'hello');
  assert.equal(result.nextCursor, null);
});
