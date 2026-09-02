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

  const result = await NativeSessionService.listForProvider({ provider: 'codex' });
  assert.equal(result.sessions[0].mappedLogicalSessionId, logical.id);
  assert.equal(result.sessions[1].mappedLogicalSessionId, null);
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
