import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-native-service-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { providerManager } = await import('../../src/providers/provider-manager.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { ProviderSessionRepository } = await import('../../src/sessions/provider-session-repository.js');
const { NativeSessionService } = await import('../../src/sessions/native-session-service.js');

initDatabase();
const db = getDb();

class ListAdapter {
  constructor(name, rows = []) { this.name = name; this.rows = rows; }
  async listNativeSessions() { return { sessions: this.rows, nextCursor: null }; }
}

class ResumeOnlyAdapter {
  constructor(name) { this.name = name; }
}

test('migration 015 enforces unique provider/native ref ownership', () => {
  const indexes = db.prepare("PRAGMA index_list('provider_sessions')").all();
  const unique = indexes.find((row) => row.name === 'uq_provider_sessions_provider_native_ref');
  assert.ok(unique);
  assert.equal(unique.unique, 1);
});

test('native list annotates existing logical mapping', async () => {
  const userId = 19001;
  const logical = SessionManager.createSession(userId, { provider: 'codex' });
  ProviderSessionRepository.bind({ sessionId: logical.id, provider: 'codex', nativeSessionRef: 'thread-mapped' });
  providerManager.registerAdapter(new ListAdapter('codex', [
    { nativeSessionRef: 'thread-mapped', title: 'Mapped thread' },
    { nativeSessionRef: 'thread-free', title: 'Free thread' }
  ]));

  const result = await NativeSessionService.listForProvider({ userId, provider: 'codex' });
  assert.equal(result.listCapability, 'FULL');
  assert.equal(result.source, 'provider-native');
  assert.equal(result.sessions[0].mappedLogicalSessionId, logical.id);
  assert.equal(result.sessions[1].mappedLogicalSessionId, null);
});

test('provider without list API falls back to this user READY mappings only', async () => {
  const userId = 19007;
  const ready = SessionManager.createSession(userId, { title: 'Agy Ready', provider: 'antigravity', model: 'gemini-test', reasoningEffort: 'high' });
  const unbound = SessionManager.createSession(userId, { title: 'Agy Unbound', provider: 'antigravity' });
  const otherUser = SessionManager.createSession(19008, { title: 'Other User', provider: 'antigravity' });
  ProviderSessionRepository.bind({ sessionId: ready.id, provider: 'antigravity', nativeSessionRef: 'agy-conversation-ready', verified: true });
  ProviderSessionRepository.ensure({ sessionId: unbound.id, provider: 'antigravity' });
  ProviderSessionRepository.bind({ sessionId: otherUser.id, provider: 'antigravity', nativeSessionRef: 'agy-conversation-other' });
  providerManager.registerAdapter(new ResumeOnlyAdapter('antigravity'));

  const result = await NativeSessionService.listForProvider({ userId, provider: 'antigravity' });
  assert.equal(result.listCapability, 'MAPPED_ONLY');
  assert.equal(result.source, 'mapping-fallback');
  assert.deepEqual(result.sessions.map((row) => row.nativeSessionRef), ['agy-conversation-ready']);
  assert.equal(result.sessions[0].mappedLogicalSessionId, ready.id);
  assert.equal(result.sessions[0].model, 'gemini-test');
  assert.equal(result.sessions[0].reasoningEffort, 'high');
});

test('provider without list API still fails when caller has no user scope', async () => {
  providerManager.registerAdapter(new ResumeOnlyAdapter('resume-only'));
  await assert.rejects(
    NativeSessionService.listForProvider({ provider: 'resume-only' }),
    (error) => error?.code === 'NATIVE_SESSION_LIST_UNSUPPORTED'
  );
});

test('unmapped native session adopt creates logical session and READY binding', () => {
  const userId = 19002;
  const result = NativeSessionService.adopt({
    userId,
    provider: 'codex',
    nativeSession: {
      nativeSessionRef: 'thread-adopt-new',
      title: 'Imported Codex thread',
      model: 'gpt-test',
      reasoningEffort: 'medium',
      source: 'exec',
      cwd: '/home/dev'
    }
  });

  assert.equal(result.adopted, true);
  assert.equal(result.session.active_provider, 'codex');
  assert.equal(result.session.title, 'Imported Codex thread');
  assert.equal(result.mapping.state, 'READY');
  assert.equal(result.mapping.native_session_ref, 'thread-adopt-new');
  assert.equal(SessionManager.getActiveSession(userId).id, result.session.id);
});

test('already mapped native session switches to its existing logical session instead of duplicating', () => {
  const userId = 19003;
  const mapped = SessionManager.createSession(userId, { title: 'Existing', provider: 'codex' });
  ProviderSessionRepository.bind({ sessionId: mapped.id, provider: 'codex', nativeSessionRef: 'thread-existing' });
  SessionManager.createSession(userId, { title: 'Other', provider: 'codex' });

  const result = NativeSessionService.adopt({
    userId,
    provider: 'codex',
    nativeSession: { nativeSessionRef: 'thread-existing', title: 'Ignored duplicate title' }
  });

  assert.equal(result.adopted, false);
  assert.equal(result.session.id, mapped.id);
  assert.equal(SessionManager.getActiveSession(userId).id, mapped.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM provider_sessions WHERE provider='codex' AND native_session_ref='thread-existing'").get().count, 1);
});

test('same native ref cannot be bound to two logical sessions', () => {
  const first = SessionManager.createSession(19004, { provider: 'codex' });
  const second = SessionManager.createSession(19004, { provider: 'codex' });
  ProviderSessionRepository.bind({ sessionId: first.id, provider: 'codex', nativeSessionRef: 'thread-unique' });
  assert.throws(
    () => ProviderSessionRepository.bind({ sessionId: second.id, provider: 'codex', nativeSessionRef: 'thread-unique' }),
    /UNIQUE constraint failed/
  );
});

test('adopt rejects a native session mapped to another user', () => {
  const owner = SessionManager.createSession(19005, { provider: 'codex' });
  ProviderSessionRepository.bind({ sessionId: owner.id, provider: 'codex', nativeSessionRef: 'thread-private' });
  assert.throws(
    () => NativeSessionService.adopt({ userId: 19006, provider: 'codex', nativeSession: { nativeSessionRef: 'thread-private' } }),
    (error) => error?.code === 'NATIVE_SESSION_OWNERSHIP_CONFLICT'
  );
});
