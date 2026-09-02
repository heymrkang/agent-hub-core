import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAntigravityExecutionResponse } from '../../src/providers/antigravity/execution-response.js';
import { AntigravityAdapter } from '../../src/providers/antigravity/antigravity-adapter.js';

test('새 Antigravity 응답은 conversation_id를 native identity로 반환한다', () => {
  const parsed = parseAntigravityExecutionResponse(JSON.stringify({
    status: 'SUCCESS',
    response: 'hello',
    conversation_id: 'agy-conv-1',
    usage: { output_tokens: 3 }
  }));
  assert.equal(parsed.response, 'hello');
  assert.equal(parsed.nativeSessionRef, 'agy-conv-1');
  assert.equal(parsed.nativeSessionCreated, true);
  assert.equal(parsed.usage.output_tokens, 3);
});

test('새 Antigravity 실행에서 conversation_id가 없으면 성공으로 강등하지 않는다', () => {
  assert.throws(
    () => parseAntigravityExecutionResponse(JSON.stringify({ status: 'SUCCESS', response: 'orphan answer' })),
    (error) => error?.code === 'ANTIGRAVITY_NATIVE_SESSION_ID_MISSING'
  );
});

test('Antigravity resume은 기존 conversation id를 유지한다', () => {
  const parsed = parseAntigravityExecutionResponse(JSON.stringify({
    status: 'SUCCESS',
    response: 'continued',
    conversation_id: 'agy-conv-2'
  }), { nativeSessionRef: 'agy-conv-2' });
  assert.equal(parsed.nativeSessionRef, 'agy-conv-2');
  assert.equal(parsed.nativeSessionCreated, false);
});

test('Antigravity resume에서 다른 conversation id가 반환되면 실패한다', () => {
  assert.throws(
    () => parseAntigravityExecutionResponse(JSON.stringify({
      status: 'SUCCESS',
      response: 'wrong',
      conversation_id: 'agy-other'
    }), { nativeSessionRef: 'agy-expected' }),
    (error) => error?.code === 'ANTIGRAVITY_NATIVE_SESSION_MISMATCH'
  );
});

test('Antigravity 구조화 JSON이 깨지면 raw text 성공 fallback을 금지한다', () => {
  assert.throws(
    () => parseAntigravityExecutionResponse('plain text response'),
    (error) => error?.code === 'ANTIGRAVITY_JSON_PARSE_ERROR'
  );
});

test('Antigravity args는 native ref가 있을 때 --conversation으로 resume한다', () => {
  const adapter = new AntigravityAdapter();
  const args = adapter.buildArgs({
    prompt: '계속 진행',
    model: 'gemini-x',
    reasoningEffort: 'medium',
    nativeSessionRef: 'agy-conv-3',
    profile: 'FULL_ACCESS'
  });
  const index = args.indexOf('--conversation');
  assert.ok(index >= 0);
  assert.equal(args[index + 1], 'agy-conv-3');
  assert.equal(args.includes('--effort'), true);
  assert.equal(args.includes('--model'), true);
});
