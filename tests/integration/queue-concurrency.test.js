import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-queue-'));
process.env.WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-workspace-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { providerManager } = await import('../../src/providers/provider-manager.js');
const { queueManager } = await import('../../src/jobs/queue-manager.js');
const { getSettingsManager } = await import('../../src/settings/settings-manager.js');

initDatabase();
const db = getDb();
db.prepare('INSERT OR IGNORE INTO users (id, role) VALUES (?, ?)').run(1, 'OWNER');
getSettingsManager().set('concurrency_limit', 2);

function addSession(id) {
  db.prepare(`INSERT INTO sessions (id,user_id,title,active_provider,execution_profile,status) VALUES(?,?,?,?,?,?)`)
    .run(id, 1, id, 'codex', 'WORKSPACE', 'ACTIVE');
}

function deferredAdapter() {
  const starts = [];
  const pending = [];
  return {
    name: 'codex',
    starts,
    pending,
    executePrompt: ({ prompt, signal }) => new Promise((resolve, reject) => {
      starts.push(prompt);
      const entry = { prompt, resolve: () => resolve({ response: prompt, nativeSessionRef: null }), reject };
      pending.push(entry);
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })
  };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function drain(adapter) {
  while (queueManager.getQueueStats().activeExecutionsCount || queueManager.getQueueStats().totalQueued) {
    for (const entry of adapter.pending.splice(0)) entry.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('same session is FIFO and never runs two jobs concurrently', async () => {
  addSession('fifo-session');
  const adapter = deferredAdapter();
  providerManager.registerAdapter(adapter);

  const first = queueManager.enqueueJob({ sessionId: 'fifo-session', provider: 'codex', model: null, prompt: 'first', profile: 'WORKSPACE' });
  const second = queueManager.enqueueJob({ sessionId: 'fifo-session', provider: 'codex', model: null, prompt: 'second', profile: 'WORKSPACE' });
  await waitFor(() => adapter.starts.length === 1);
  assert.deepEqual(adapter.starts, ['first']);
  assert.equal(queueManager.getQueueStats().totalQueued, 1);

  adapter.pending.shift().resolve();
  await first;
  await waitFor(() => adapter.starts.length === 2);
  assert.deepEqual(adapter.starts, ['first', 'second']);
  adapter.pending.shift().resolve();
  assert.equal(await second, 'second');
});

test('different sessions honor global provider concurrency limit and saturation', async () => {
  for (const id of ['multi-a', 'multi-b', 'multi-c']) addSession(id);
  const adapter = deferredAdapter();
  providerManager.registerAdapter(adapter);

  const jobs = ['multi-a', 'multi-b', 'multi-c'].map((sessionId, index) => queueManager.enqueueJob({
    sessionId, provider: 'codex', model: null, prompt: `job-${index + 1}`, profile: 'WORKSPACE'
  }));
  await waitFor(() => adapter.starts.length === 2);
  assert.equal(queueManager.getQueueStats().activeExecutionsCount, 2);
  assert.equal(queueManager.getQueueStats().totalQueued, 1);
  assert.deepEqual(adapter.starts, ['job-1', 'job-2']);

  adapter.pending.shift().resolve();
  await waitFor(() => adapter.starts.length === 3);
  assert.equal(queueManager.getQueueStats().activeExecutionsCount, 2);
  await drain(adapter);
  await Promise.all(jobs);
});

test('queued and running jobs can both be stopped', async () => {
  getSettingsManager().set('concurrency_limit', 1);
  for (const id of ['stop-a', 'stop-b']) addSession(id);
  const adapter = deferredAdapter();
  providerManager.registerAdapter(adapter);

  const running = queueManager.enqueueJob({ sessionId: 'stop-a', provider: 'codex', model: null, prompt: 'running', profile: 'WORKSPACE' });
  const queued = queueManager.enqueueJob({ sessionId: 'stop-b', provider: 'codex', model: null, prompt: 'queued', profile: 'WORKSPACE' });
  await waitFor(() => adapter.starts.length === 1 && queueManager.getQueueStats().totalQueued === 1);

  assert.equal(queueManager.cancelJob(queued.jobId), true);
  await assert.rejects(queued, /대기 중 취소/);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(queued.jobId).status, 'CANCELLED');

  assert.equal(queueManager.cancelJob(running.jobId), true);
  await assert.rejects(running, /취소/);
  await waitFor(() => queueManager.getQueueStats().activeExecutionsCount === 0);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(running.jobId).status, 'CANCELLED');
});
