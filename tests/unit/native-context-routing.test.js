import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-native-context-'));

const { initDatabase } = await import('../../src/database/index.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { ProviderSessionRepository } = await import('../../src/sessions/provider-session-repository.js');
const { ContextAssembler, selectCrossProviderDelta } = await import('../../src/context/context-assembler.js');

initDatabase();
const userId = 18111;

function createSession(provider = 'codex') {
  return SessionManager.createSession(userId, { provider, model: null, reasoningEffort: 'default' });
}

test('same-provider native continuation은 canonical history와 global memory를 prompt에 다시 주입하지 않는다', async () => {
  const session = createSession('codex');
  const firstUser = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: '1단계 진행' });
  ProviderSessionRepository.bind({ sessionId: session.id, provider: 'codex', nativeSessionRef: 'codex-thread-a', lastSyncedMessageId: firstUser });
  SessionManager.saveMessage({ sessionId: session.id, role: 'assistant', text: '1단계 완료', provider: 'codex', model: 'gpt-test' });
  const currentUser = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: '2단계 진행' });

  const prepared = await ContextAssembler.prepareForProvider({
    session,
    userMessageId: currentUser,
    memoryBlock: '[Global Memory]\n공통 지침',
    currentPrompt: '2단계 진행'
  });

  assert.equal(prepared.mode, 'NATIVE_CONTINUATION');
  assert.equal(prepared.context.missedMessageCount, 0);
  assert.match(prepared.prompt, /2단계 진행/);
  assert.doesNotMatch(prepared.prompt, /공통 지침|Global Memory/);
  assert.doesNotMatch(prepared.prompt, /1단계 진행/);
  assert.doesNotMatch(prepared.prompt, /1단계 완료/);
  assert.doesNotMatch(prepared.prompt, /대화 요약|이전 대화 기록/);
  assert.equal(prepared.autoCompact.status, 'NATIVE_SESSION_BYPASS');
});

test('provider 왕복 시 다른 Provider가 처리한 구간만 native delta로 전달한다', async () => {
  const session = createSession('codex');
  const codexUser = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'Codex에서 1단계' });
  ProviderSessionRepository.bind({ sessionId: session.id, provider: 'codex', nativeSessionRef: 'codex-thread-b', lastSyncedMessageId: codexUser });
  SessionManager.saveMessage({ sessionId: session.id, role: 'assistant', text: 'Codex 1단계 완료', provider: 'codex', model: 'gpt-test' });

  SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'Antigravity에서 구조 변경' });
  SessionManager.saveMessage({ sessionId: session.id, role: 'assistant', text: '구조를 B로 변경 완료', provider: 'antigravity', model: 'gemini-test' });
  const returnUser = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'Codex로 돌아와서 계속' });

  const prepared = await ContextAssembler.prepareForProvider({
    session,
    userMessageId: returnUser,
    currentPrompt: 'Codex로 돌아와서 계속'
  });

  assert.equal(prepared.mode, 'NATIVE_DELTA');
  assert.equal(prepared.context.missedMessageCount, 2);
  assert.match(prepared.prompt, /Provider Handoff Delta/);
  assert.match(prepared.prompt, /Antigravity에서 구조 변경/);
  assert.match(prepared.prompt, /구조를 B로 변경 완료/);
  assert.match(prepared.prompt, /Codex로 돌아와서 계속/);
  assert.doesNotMatch(prepared.prompt, /Codex 1단계 완료/);
});

test('selectCrossProviderDelta는 same-provider trailing assistant만 있으면 빈 delta를 반환한다', () => {
  const rows = [
    { role: 'assistant', text: '이미 native thread에 있음', provider: 'codex' }
  ];
  assert.deepEqual(selectCrossProviderDelta(rows, 'codex'), []);
});

test('selectCrossProviderDelta는 첫 external assistant 직전 user부터 보존한다', () => {
  const rows = [
    { role: 'assistant', text: 'codex previous answer', provider: 'codex' },
    { role: 'user', text: 'switch work' },
    { role: 'assistant', text: 'agy answer', provider: 'antigravity' },
    { role: 'user', text: 'agy followup' },
    { role: 'assistant', text: 'agy answer 2', provider: 'antigravity' }
  ];
  assert.deepEqual(selectCrossProviderDelta(rows, 'codex'), rows.slice(1));
});
