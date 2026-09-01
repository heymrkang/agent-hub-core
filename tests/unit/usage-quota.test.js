import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexRateLimits } from '../../src/providers/codex/codex-adapter.js';
import { parseAntigravityUsage } from '../../src/providers/antigravity/antigravity-adapter.js';
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

test('Antigravity 구조화 usage를 모델 그룹별 quota로 변환한다', () => {
  const result = parseAntigravityUsage({ command: { data: { groups: [
    { name: 'Gemini Models', buckets: [
      { id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.902, reset_time: '2026-09-01T11:51:14Z' },
      { id: 'gemini-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.967, reset_time: '2026-09-01T12:05:00Z' }
    ] },
    { name: 'Claude and GPT models', buckets: [
      { id: '3p-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2026-09-08T07:52:21Z' }
    ] }
  ] } } }, '2026-09-01T08:30:00.000Z');
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.windows[0], { id: 'gemini-weekly', group: 'Gemini Models', label: '주간 한도', remainingPercent: 90, resetsAt: '2026-09-01T11:51:14.000Z' });
  assert.equal(result.windows[1].label, '5시간 한도');
  assert.equal(result.windows[1].remainingPercent, 97);
  assert.equal(result.windows[2].group, 'Claude and GPT models');
});

test('Antigravity quota 일부 필드 누락은 PARTIAL이며 사용률을 추정하지 않는다', () => {
  const result = parseAntigravityUsage({ command: { data: { groups: [{ name: 'Gemini Models', buckets: [
    { id: 'valid', window: 'weekly', remaining_fraction: 0.5 },
    { id: 'missing', window: '5h' }
  ] }] } } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].remainingPercent, 50);
  assert.equal('usedPercent' in result.windows[0], false);
  assert.throws(() => parseAntigravityUsage({}), /command\.data\.groups/);
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

test('quota UI는 원본 percentage 의미와 모델 그룹을 분리한다', () => {
  const text = renderQuota({ provider: 'codex', status: 'AVAILABLE', cache: 'HIT', fetchedAt: '2026-09-01T00:00:00Z', windows: [{ label: '5시간 한도', usedPercent: 42, remainingPercent: 58 }] });
  assert.match(text, /`\[CODEX\]` · `AVAILABLE`/);
  assert.match(text, /42% 사용 \/ 58% 남음/);
  assert.match(text, /Reset 미제공\n\n조회/);
  const antigravity = renderQuota({ provider: 'antigravity', status: 'AVAILABLE', cache: 'MISS', fetchedAt: '2026-09-01T08:30:00Z', windows: [
    { group: 'Gemini Models', label: '주간 한도', remainingPercent: 90, resetsAt: '2026-09-01T11:51:14Z' },
    { group: 'Gemini Models', label: '5시간 한도', remainingPercent: 97, resetsAt: '2026-09-01T12:05:00Z' },
    { group: 'Claude and GPT models', label: '주간 한도', remainingPercent: 100, resetsAt: '2026-09-08T07:52:21Z' }
  ] });
  assert.match(antigravity, /`\[ANTIGRAVITY\]` · `AVAILABLE`/);
  assert.match(antigravity, /`\[Gemini Models\]`/);
  assert.match(antigravity, /90% 남음/);
  assert.match(antigravity, /`\[Claude and GPT models\]`/);
});
