import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-compact-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { ContextManager } = await import('../../src/context/context-manager.js');
const { Compactor } = await import('../../src/context/compactor.js');
const { JobRuntime } = await import('../../src/jobs/job-runtime.js');
const { providerManager } = await import('../../src/providers/provider-manager.js');
const { queueManager } = await import('../../src/jobs/queue-manager.js');

initDatabase();
const db = getDb();
const userId = 1602;

function createSession(messageCount = 16) {
  const session = SessionManager.createSession(userId, { provider: 'compact-test' });
  for (let index = 1; index <= messageCount; index += 1) {
    SessionManager.saveMessage({
      sessionId: session.id,
      role: index % 2 ? 'user' : 'assistant',
      text: `message-${index}`
    });
  }
  return session;
}

function registerAdapter(executePrompt) {
  providerManager.registerAdapter({ name: 'compact-test', executePrompt });
}

test('migration 013 adds compact metadata and reasoning default', () => {
  const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name));
  for (const name of ['compact_cursor_message_id', 'last_compacted_at', 'compact_before_chars', 'compact_after_chars', 'reasoning_effort']) {
    assert.equal(columns.has(name), true);
  }
  const session = createSession(0);
  assert.equal(SessionManager.getSession(session.id).reasoning_effort, 'default');
});

test('compact preserves canonical messages and keeps the latest ten raw', async () => {
  const session = createSession();
  registerAdapter(async ({ prompt, profile }) => {
    assert.equal(profile, 'READ_ONLY');
    assert.match(prompt, /message-1/);
    assert.doesNotMatch(prompt, /message-7/);
    return { response: '첫 번째 rolling summary' };
  });
  const before = db.prepare('SELECT id, text FROM messages WHERE session_id=? ORDER BY rowid').all(session.id);
  const result = await Compactor.compactSession(session.id);
  const after = db.prepare('SELECT id, text FROM messages WHERE session_id=? ORDER BY rowid').all(session.id);
  const state = SessionManager.getSession(session.id);

  assert.equal(result.status, 'COMPACTED');
  assert.equal(result.compactedMessages, 6);
  assert.equal(result.retainedMessages, 10);
  assert.deepEqual(after, before);
  assert.equal(state.rolling_summary, '첫 번째 rolling summary');
  assert.equal(state.compact_cursor_message_id, before[5].id);
  assert.ok(state.last_compacted_at);
  assert.equal(state.compact_before_chars, 54);
  assert.equal(state.compact_after_chars, 20);
});

test('repeated compact rolls the old summary into only the new range', async () => {
  const session = createSession();
  let calls = 0;
  registerAdapter(async ({ prompt }) => {
    calls += 1;
    if (calls === 1) return { response: 'summary-v1' };
    assert.match(prompt, /summary-v1/);
    assert.match(prompt, /message-7/);
    assert.doesNotMatch(prompt, /\nmessage-1\n/);
    return { response: 'summary-v2' };
  });
  await Compactor.compactSession(session.id);
  for (let index = 17; index <= 22; index += 1) {
    SessionManager.saveMessage({ sessionId: session.id, role: index % 2 ? 'user' : 'assistant', text: `message-${index}` });
  }
  const second = await Compactor.compactSession(session.id);
  assert.equal(second.compactedMessages, 6);
  assert.equal(SessionManager.getSession(session.id).rolling_summary, 'summary-v2');
});

test('short range is NO_CHANGE and never invokes provider', async () => {
  const session = createSession(15);
  registerAdapter(async () => { throw new Error('must not execute'); });
  const result = await Compactor.compactSession(session.id);
  assert.equal(result.status, 'NO_CHANGE');
  assert.equal(SessionManager.getSession(session.id).rolling_summary, null);
});

test('provider failure leaves summary and cursor unchanged', async () => {
  const session = createSession();
  db.prepare('UPDATE sessions SET rolling_summary=? WHERE id=?').run('old summary', session.id);
  registerAdapter(async () => { throw new Error('summary failed'); });
  await assert.rejects(Compactor.compactSession(session.id), /summary failed/);
  const state = SessionManager.getSession(session.id);
  assert.equal(state.rolling_summary, 'old summary');
  assert.equal(state.compact_cursor_message_id, null);
  assert.equal(state.last_compacted_at, null);
});

test('active jobs and concurrent compact calls return BUSY', async () => {
  const jobSession = createSession();
  const job = JobRuntime.createJob({ sessionId: jobSession.id, provider: 'compact-test' });
  assert.equal((await Compactor.compactSession(jobSession.id)).status, 'BUSY');
  JobRuntime.markCancelled(job.id);

  const session = createSession();
  let release;
  registerAdapter(() => new Promise((resolve) => { release = () => resolve({ response: 'summary' }); }));
  const first = Compactor.compactSession(session.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await Compactor.compactSession(session.id)).status, 'BUSY');
  assert.throws(() => queueManager.enqueueJob({
    sessionId: session.id,
    provider: 'compact-test',
    prompt: 'must wait',
    profile: 'WORKSPACE'
  }), (error) => error.code === 'COMPACT_BUSY');
  release();
  assert.equal((await first).status, 'COMPACTED');
});
