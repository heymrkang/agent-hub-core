import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-native-session-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { ProviderSessionRepository } = await import('../../src/sessions/provider-session-repository.js');
const { ContextManager } = await import('../../src/context/context-manager.js');

initDatabase();
const db = getDb();
const userId = 18002;

function newSession(provider = 'codex') {
  return SessionManager.createSession(userId, { provider });
}

test('migration 015 adds native session lifecycle metadata and unique mapping index', () => {
  const columns = new Set(db.prepare('PRAGMA table_info(provider_sessions)').all().map((row) => row.name));
  for (const name of ['state', 'bound_at', 'last_verified_at', 'last_error', 'metadata_json']) {
    assert.equal(columns.has(name), true, `missing provider_sessions.${name}`);
  }

  const indexes = db.prepare("PRAGMA index_list('provider_sessions')").all();
  const unique = indexes.find((row) => row.name === 'uq_provider_sessions_session_provider');
  assert.ok(unique);
  assert.equal(unique.unique, 1);
});

test('ensure creates one UNBOUND mapping per logical session/provider', () => {
  const session = newSession();
  const first = ProviderSessionRepository.ensure({ sessionId: session.id, provider: 'Codex' });
  const second = ProviderSessionRepository.ensure({ sessionId: session.id, provider: 'codex' });

  assert.equal(first.id, second.id);
  assert.equal(first.provider, 'codex');
  assert.equal(first.state, 'UNBOUND');
  assert.equal(first.native_session_ref, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM provider_sessions WHERE session_id=? AND provider=?').get(session.id, 'codex').count, 1);
});

test('bind promotes mapping to READY and preserves sync metadata', () => {
  const session = newSession();
  const messageId = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'hello' });
  const row = ProviderSessionRepository.bind({
    sessionId: session.id,
    provider: 'codex',
    nativeSessionRef: '01a061db-2fe1-7fc2-89dc-ffaafceae1be',
    lastSyncedMessageId: messageId,
    metadata: { source: 'thread.started' },
    verified: true
  });

  assert.equal(row.state, 'READY');
  assert.equal(row.native_session_ref, '01a061db-2fe1-7fc2-89dc-ffaafceae1be');
  assert.equal(row.last_synced_message_id, messageId);
  assert.ok(row.bound_at);
  assert.ok(row.last_verified_at);
  assert.deepEqual(JSON.parse(row.metadata_json), { source: 'thread.started' });
});

test('failure state is explicit and a successful rebind clears the error', () => {
  const session = newSession('antigravity');
  ProviderSessionRepository.bind({ sessionId: session.id, provider: 'antigravity', nativeSessionRef: 'conversation-a' });
  const failed = ProviderSessionRepository.markFailure({ sessionId: session.id, provider: 'antigravity', state: 'MISSING', error: new Error('conversation not found') });
  assert.equal(failed.state, 'MISSING');
  assert.match(failed.last_error, /conversation not found/);

  const rebound = ProviderSessionRepository.bind({ sessionId: session.id, provider: 'antigravity', nativeSessionRef: 'conversation-b' });
  assert.equal(rebound.state, 'READY');
  assert.equal(rebound.native_session_ref, 'conversation-b');
  assert.equal(rebound.last_error, null);
});

test('ContextManager compatibility path delegates to the repository without duplicate rows', () => {
  const session = newSession();
  const firstMessage = SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'one' });
  ContextManager.upsertProviderSession({ sessionId: session.id, provider: 'codex', nativeSessionRef: 'native-1', lastSyncedMessageId: firstMessage });
  const secondMessage = SessionManager.saveMessage({ sessionId: session.id, role: 'assistant', text: 'two' });
  ContextManager.upsertProviderSession({ sessionId: session.id, provider: 'codex', nativeSessionRef: null, lastSyncedMessageId: secondMessage });

  const row = ContextManager.getProviderSession(session.id, 'codex');
  assert.equal(row.state, 'READY');
  assert.equal(row.native_session_ref, 'native-1');
  assert.equal(row.last_synced_message_id, secondMessage);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM provider_sessions WHERE session_id=? AND provider=?').get(session.id, 'codex').count, 1);
});

test('resetToUnbound clears provider-owned continuity without deleting logical transcript', () => {
  const session = newSession();
  SessionManager.saveMessage({ sessionId: session.id, role: 'user', text: 'keep me' });
  ProviderSessionRepository.bind({ sessionId: session.id, provider: 'codex', nativeSessionRef: 'native-reset' });
  const row = ProviderSessionRepository.resetToUnbound({ sessionId: session.id, provider: 'codex' });

  assert.equal(row.state, 'UNBOUND');
  assert.equal(row.native_session_ref, null);
  assert.equal(row.last_synced_message_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id=?').get(session.id).count, 1);
});
