import test from 'node:test';
import assert from 'node:assert/strict';

import { CodexExecJsonlParser, parseCodexExecJsonl } from '../../src/providers/codex/exec-jsonl.js';
import { CodexAdapter } from '../../src/providers/codex/codex-adapter.js';

const THREAD_ID = '01a061db-2fe1-7fc2-89dc-ffaafceae1be';

const LIVE_PROBE_JSONL = [
  JSON.stringify({ type: 'thread.started', thread_id: THREAD_ID }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'NATIVE_SESSION_PROBE' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 14582, cached_input_tokens: 11264, cache_write_input_tokens: 0, output_tokens: 9, reasoning_output_tokens: 0 } })
].join('\n');

test('Codex 0.149.1 live probe JSONL에서 native thread, 응답, usage를 추출한다', () => {
  const parsed = parseCodexExecJsonl(LIVE_PROBE_JSONL, { requireThreadId: true });
  assert.equal(parsed.nativeSessionRef, THREAD_ID);
  assert.equal(parsed.response, 'NATIVE_SESSION_PROBE');
  assert.equal(parsed.usage.input_tokens, 14582);
  assert.equal(parsed.usage.cached_input_tokens, 11264);
  assert.equal(parsed.eventCount, 4);
});

test('JSONL parser는 chunk 경계가 JSON line 중간이어도 thread continuity를 보존한다', () => {
  const parser = new CodexExecJsonlParser({ requireThreadId: true });
  const pivot = LIVE_PROBE_JSONL.indexOf(THREAD_ID) + 7;
  parser.push(LIVE_PROBE_JSONL.slice(0, pivot));
  parser.push(LIVE_PROBE_JSONL.slice(pivot));
  const parsed = parser.finish();
  assert.equal(parsed.nativeSessionRef, THREAD_ID);
  assert.equal(parsed.response, 'NATIVE_SESSION_PROBE');
});

test('새 Codex native session 성공 결과에 thread.started가 없으면 실패한다', () => {
  const jsonl = [
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello' } }),
    JSON.stringify({ type: 'turn.completed', usage: {} })
  ].join('\n');
  assert.throws(
    () => parseCodexExecJsonl(jsonl, { requireThreadId: true }),
    (error) => error?.code === 'CODEX_NATIVE_THREAD_ID_MISSING'
  );
});

test('resume에서 Codex가 다른 thread_id를 반환하면 silent continuation을 금지한다', () => {
  const jsonl = [
    JSON.stringify({ type: 'thread.started', thread_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'wrong thread' } })
  ].join('\n');
  assert.throws(
    () => parseCodexExecJsonl(jsonl, { expectedThreadId: THREAD_ID }),
    (error) => error?.code === 'CODEX_NATIVE_THREAD_MISMATCH'
  );
});

test('새 Codex 실행 args는 JSONL persistent session을 만들고 기존 model/thinking/profile flags를 유지한다', () => {
  const codex = new CodexAdapter();
  const args = codex.buildCodexArgs({ prompt: '현재 요청', model: 'gpt-x', reasoningEffort: 'high' });
  assert.deepEqual(args.slice(0, 6), ['exec', '-m', 'gpt-x', '-c', 'model_reasoning_effort="high"', '--skip-git-repo-check']);
  assert.equal(args.includes('resume'), false);
  assert.equal(args.includes('--json'), true);
  assert.equal(args.includes('--ephemeral'), false);
  assert.equal(args.at(-1), '현재 요청');
});

test('Codex resume args는 저장된 native thread에 현재 prompt를 직접 전달한다', () => {
  const codex = new CodexAdapter();
  const args = codex.buildCodexArgs({
    prompt: '17-6-2 진행',
    model: 'gpt-x',
    reasoningEffort: 'medium',
    nativeSessionRef: THREAD_ID
  });
  assert.deepEqual(args.slice(0, 2), ['exec', 'resume']);
  assert.equal(args.includes('--json'), true);
  assert.equal(args.includes('--skip-git-repo-check'), true);
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), true);
  assert.equal(args[args.length - 2], THREAD_ID);
  assert.equal(args.at(-1), '17-6-2 진행');
});

test('resume JSONL에 thread.started가 생략돼도 요청한 native thread를 identity로 유지한다', () => {
  const jsonl = [
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'continued' } }),
    JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 1 } })
  ].join('\n');
  const parsed = parseCodexExecJsonl(jsonl, { expectedThreadId: THREAD_ID });
  assert.equal(parsed.nativeSessionRef, THREAD_ID);
  assert.equal(parsed.response, 'continued');
});

test('malformed JSONL은 일반 텍스트 응답으로 조용히 강등하지 않는다', () => {
  const parser = new CodexExecJsonlParser({ requireThreadId: true });
  assert.throws(
    () => parser.push('{not-json}\n'),
    (error) => error?.code === 'CODEX_JSONL_PARSE_ERROR'
  );
});
