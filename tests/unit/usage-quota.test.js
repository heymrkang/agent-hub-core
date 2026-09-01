import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexRateLimits } from '../../src/providers/codex/codex-adapter.js';
import { UsageQuotaService } from '../../src/providers/usage-quota-service.js';
import { renderQuota } from '../../src/telegram/commands/usage.js';

test('Codex rate limit canonical 필드만 window로 변환한다', () => {
  const result = parseCodexRateLimits({ rateLimits: {
    primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
    secondary: { usedPercent: 67, windowDurationMins: 10080, resetsAt: 1_800_604_800, extra: 'ignore' }
  } }, '2026-09-01T00:00:00.000Z');
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.windows[0], { id: 'primary', label: '5시간 한도', usedPercent: 42, remainingPercent: 58, windowDurationMins: 300, resetsAt: '2027-01-15T08:00:00.000Z' });
  assert.equal(result.windows[1].label, '주간 한도');
  assert.equal(result.windows[1].remainingPercent, 33);
  assert.equal('extra' in result.windows[1], false);
});

test('필드가 빠진 Codex 응답은 추정하지 않고 PARTIAL이다', () => {
  const result = parseCodexRateLimits({ primary: { usedPercent: 20 } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.windows[0].remainingPercent, 80);
  assert.equal(result.windows[0].resetsAt, undefined);
});

test('usage cache hit과 single-flight가 probe를 중복하지 않는다', async () => {
  let calls = 0; let release;
  const adapter = { getUsageQuota: () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  const service = new UsageQuotaService({ providerManager: { getAdapter: () => adapter } });
  const a = service.get('codex'); const b = service.get('codex');
  release({ provider: 'codex', status: 'AVAILABLE', windows: [], fetchedAt: new Date().toISOString() });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal(first.cache, 'MISS'); assert.equal(second.cache, 'MISS');
  assert.equal((await service.get('codex')).cache, 'HIT'); assert.equal(calls, 1);
});

test('실패 시 10분 이내 마지막 성공값을 STALE로 반환한다', async () => {
  let now = Date.parse('2026-09-01T00:00:00Z'); let fail = false;
  const adapter = { async getUsageQuota() { if (fail) throw new Error('credential secret-value expired'); return { provider: 'codex', status: 'AVAILABLE', windows: [], fetchedAt: new Date(now).toISOString() }; } };
  const service = new UsageQuotaService({ providerManager: { getAdapter: () => adapter }, now: () => now });
  await service.get('codex'); fail = true; now += 61_000;
  const stale = await service.get('codex');
  assert.equal(stale.cache, 'STALE'); assert.equal(stale.stale, true); assert.doesNotMatch(stale.error, /secret-value/);
});

test('강제 새로고침 cooldown과 probe timeout을 구분한다', async () => {
  let calls = 0;
  const fast = new UsageQuotaService({ providerManager: { getAdapter: () => ({ async getUsageQuota() { calls++; return { provider: 'codex', status: 'AVAILABLE', windows: [] }; } }) } });
  await fast.get('codex', { forceRefresh: true });
  const cooldown = await fast.get('codex', { forceRefresh: true });
  assert.equal(cooldown.cache, 'COOLDOWN'); assert.equal(calls, 1);

  const slow = new UsageQuotaService({ providerManager: { getAdapter: () => ({ getUsageQuota: () => new Promise(() => {}) }) }, timeoutMs: 5 });
  const timeout = await slow.get('codex');
  assert.equal(timeout.status, 'ERROR'); assert.match(timeout.error, /시간 초과/);
});

test('quota UI는 원본 percentage 의미와 unavailable을 분리한다', () => {
  const text = renderQuota({ provider: 'codex', status: 'AVAILABLE', cache: 'HIT', fetchedAt: '2026-09-01T00:00:00Z', windows: [{ label: '5시간 한도', usedPercent: 42, remainingPercent: 58 }] });
  assert.match(text, /42% 사용 \/ 58% 남음/);
  assert.match(renderQuota({ provider: 'antigravity', status: 'UNAVAILABLE', windows: [] }), /신뢰 가능한 quota 조회 인터페이스 없음/);
});
