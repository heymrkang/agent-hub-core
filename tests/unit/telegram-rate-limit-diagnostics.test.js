import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramTransport, TelegramDeliveryError } from '../../src/telegram/transport.js';
import { JobStatusRenderer } from '../../src/telegram/renderer/job-status.js';
import { JobStatus } from '../../src/jobs/types.js';

function fakeBot(overrides = {}) {
  return {
    sendMessage: async () => true,
    editMessageText: async () => true,
    deleteMessage: async () => true,
    answerCallbackQuery: async () => true,
    ...overrides
  };
}

async function captureWarns(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try { await fn(lines); }
  finally { console.warn = original; }
  return lines;
}

test('Telegram 429 진단 로그에 method와 deferred key/대기시간을 남긴다', async () => {
  let now = 1000;
  const rateError = Object.assign(new Error('Too Many Requests: retry after 8'), {
    response: { statusCode: 429, body: { error_code: 429, description: 'Too Many Requests: retry after 8', parameters: { retry_after: 8 } } }
  });
  const transport = new TelegramTransport(fakeBot({ sendMessage: async () => { throw rateError; } }), {
    now: () => now,
    sleepFn: async () => {}
  });

  const lines = await captureWarns(async () => {
    await assert.rejects(() => transport.call('sendMessage', [1, 'hello']), TelegramDeliveryError);
    transport.defer('job-response:job-1:0', async () => true);
    now = 9500;
    transport.cooldownUntil = 0;
    await transport.flushDeferred();
  });

  assert.ok(lines.some((line) => line.includes('RATE_LIMIT method=sendMessage cooldown=8s')));
  assert.ok(lines.some((line) => line.includes('deferred queued key=job-response:job-1:0')));
  assert.ok(lines.some((line) => line.includes('deferred attempt key=job-response:job-1:0')));
  assert.ok(lines.some((line) => line.includes('deferred success key=job-response:job-1:0')));
  assert.equal(transport.deferred.size, 0);
  assert.equal(transport.deferredMeta.size, 0);
});

test('RUNNING 상태 edit이 429면 상태/세션 식별 로그를 남기되 기존 동작은 유지한다', async () => {
  const rateError = new TelegramDeliveryError('rate limit', {
    method: 'editMessageText', category: 'RATE_LIMIT', statusCode: 429, retryAfter: 8
  });
  const bot = {
    editMessageText: async () => { throw rateError; },
    deleteMessage: async () => true,
    __telegramTransport: {
      isRateLimitedError: (error) => error === rateError,
      defer: () => { throw new Error('RUNNING status는 deferred 대상이 아니다'); }
    }
  };
  const job = { sessionId: 'session-429', sessionTitle: 'test', provider: 'antigravity', model: 'default', reasoningEffort: 'default' };
  const originalInterval = JobStatusRenderer.updateIntervalMs;
  JobStatusRenderer.updateIntervalMs = 5000;
  JobStatusRenderer.lastUpdateAt.clear();
  JobStatusRenderer.lastUpdateAt.set(JobStatusRenderer.key(1, 2), Date.now() - 6000);

  try {
    const lines = await captureWarns(async () => {
      const result = await JobStatusRenderer.updateStatus(bot, 1, 2, job, JobStatus.RUNNING, 90);
      assert.equal(result, false);
    });
    assert.ok(lines.some((line) => line.includes('RATE_LIMIT status=RUNNING session=session-429 message=2 elapsed=90s retry_after=8s terminal=false')));
  } finally {
    JobStatusRenderer.updateIntervalMs = originalInterval;
    JobStatusRenderer.lastUpdateAt.clear();
  }
});
