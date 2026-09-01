import test from 'node:test';
import assert from 'node:assert/strict';
import { JobStatusRenderer } from '../../src/telegram/renderer/job-status.js';
import { JobStatus } from '../../src/jobs/types.js';
import { TelegramDeliveryError } from '../../src/telegram/transport.js';

const job = { sessionId: 's1', sessionTitle: 'test', provider: 'codex', model: 'gpt-x', reasoningEffort: 'medium' };

test('RUNNING 상태 갱신은 기본적으로 15초 단위로 throttling 된다', async () => {
  const originalInterval = JobStatusRenderer.updateIntervalMs;
  JobStatusRenderer.updateIntervalMs = 15000;
  JobStatusRenderer.lastUpdateAt.clear();
  let edits = 0;
  const bot = { editMessageText: async () => { edits += 1; }, deleteMessage: async () => true };
  const key = JobStatusRenderer.key(1, 2);
  JobStatusRenderer.lastUpdateAt.set(key, Date.now());
  try {
    assert.equal(await JobStatusRenderer.updateStatus(bot, 1, 2, job, JobStatus.RUNNING, 1), false);
    assert.equal(edits, 0);
    JobStatusRenderer.lastUpdateAt.set(key, Date.now() - 16000);
    assert.equal(await JobStatusRenderer.updateStatus(bot, 1, 2, job, JobStatus.RUNNING, 16), true);
    assert.equal(edits, 1);
  } finally {
    JobStatusRenderer.updateIntervalMs = originalInterval;
    JobStatusRenderer.lastUpdateAt.clear();
  }
});

test('terminal 상태가 429에 걸리면 cooldown 이후 재전송 대상으로 보관한다', async () => {
  const deferred = [];
  const rateError = new TelegramDeliveryError('rate limit', { method: 'editMessageText', category: 'RATE_LIMIT', statusCode: 429, retryAfter: 30 });
  const bot = {
    editMessageText: async () => { throw rateError; },
    deleteMessage: async () => true,
    __telegramTransport: {
      isRateLimitedError: (error) => error === rateError,
      defer: (key, operation) => { deferred.push({ key, operation }); return true; }
    }
  };
  const result = await JobStatusRenderer.updateStatus(bot, 1, 2, job, JobStatus.FAILED, 600);
  assert.equal(result, false);
  assert.equal(deferred.length, 1);
  assert.match(deferred[0].key, /job-status:1:2/);
});

test('COMPLETED delete가 429면 delete 작업을 deferred queue에 넣는다', async () => {
  const deferred = [];
  const rateError = new TelegramDeliveryError('rate limit', { method: 'deleteMessage', category: 'RATE_LIMIT', statusCode: 429, retryAfter: 10 });
  const bot = {
    editMessageText: async () => true,
    deleteMessage: async () => { throw rateError; },
    __telegramTransport: {
      isRateLimitedError: (error) => error === rateError,
      defer: (key, operation) => { deferred.push({ key, operation }); return true; }
    }
  };
  const result = await JobStatusRenderer.updateStatus(bot, 1, 9, job, JobStatus.COMPLETED, 20);
  assert.equal(result, false);
  assert.equal(deferred.length, 1);
  assert.match(deferred[0].key, /job-status:1:9/);
});
