import crypto from 'crypto';
import { getDb } from '../database/index.js';

export const PROVIDER_SESSION_STATES = new Set(['UNBOUND', 'READY', 'MISSING', 'ERROR']);

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) throw new Error('Provider 이름이 필요합니다.');
  return value;
}

function normalizeNativeRef(nativeSessionRef) {
  const value = String(nativeSessionRef || '').trim();
  if (!value) throw new Error('Native session ref가 필요합니다.');
  return value;
}

function encodeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  return JSON.stringify(metadata);
}

export class ProviderSessionRepository {
  static get(sessionId, provider) {
    return getDb().prepare(`SELECT * FROM provider_sessions WHERE session_id = ? AND provider = ?`)
      .get(sessionId, normalizeProvider(provider)) || null;
  }

  static list(sessionId) {
    return getDb().prepare(`SELECT * FROM provider_sessions WHERE session_id = ? ORDER BY provider ASC`).all(sessionId);
  }

  static ensure({ sessionId, provider }) {
    const db = getDb();
    const pName = normalizeProvider(provider);
    db.prepare(`INSERT INTO provider_sessions (id, session_id, provider, state)
      VALUES (?, ?, ?, 'UNBOUND')
      ON CONFLICT(session_id, provider) DO NOTHING`)
      .run(crypto.randomUUID(), sessionId, pName);
    return this.get(sessionId, pName);
  }

  static bind({ sessionId, provider, nativeSessionRef, lastSyncedMessageId = null, metadata = null, verified = false }) {
    const db = getDb();
    const pName = normalizeProvider(provider);
    const nativeRef = normalizeNativeRef(nativeSessionRef);
    const metadataJson = encodeMetadata(metadata);
    const bindTx = db.transaction(() => {
      this.ensure({ sessionId, provider: pName });
      db.prepare(`UPDATE provider_sessions
        SET native_session_ref = ?, state = 'READY',
            last_synced_message_id = COALESCE(?, last_synced_message_id),
            bound_at = COALESCE(bound_at, datetime('now')),
            last_verified_at = CASE WHEN ? THEN datetime('now') ELSE last_verified_at END,
            last_error = NULL,
            metadata_json = COALESCE(?, metadata_json),
            updated_at = datetime('now')
        WHERE session_id = ? AND provider = ?`)
        .run(nativeRef, lastSyncedMessageId || null, verified ? 1 : 0, metadataJson, sessionId, pName);
    });
    bindTx();
    return this.get(sessionId, pName);
  }

  static setSyncCursor({ sessionId, provider, lastSyncedMessageId }) {
    const pName = normalizeProvider(provider);
    this.ensure({ sessionId, provider: pName });
    getDb().prepare(`UPDATE provider_sessions
      SET last_synced_message_id = ?, updated_at = datetime('now')
      WHERE session_id = ? AND provider = ?`)
      .run(lastSyncedMessageId || null, sessionId, pName);
    return this.get(sessionId, pName);
  }

  static markVerified({ sessionId, provider }) {
    const pName = normalizeProvider(provider);
    const row = this.get(sessionId, pName);
    if (!row) throw new Error('Provider session mapping을 찾을 수 없습니다.');
    if (!row.native_session_ref) throw new Error('UNBOUND mapping은 verified 처리할 수 없습니다.');
    getDb().prepare(`UPDATE provider_sessions
      SET state = 'READY', last_verified_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
      WHERE session_id = ? AND provider = ?`)
      .run(sessionId, pName);
    return this.get(sessionId, pName);
  }

  static markFailure({ sessionId, provider, state = 'ERROR', error }) {
    const normalizedState = String(state || '').toUpperCase();
    if (!PROVIDER_SESSION_STATES.has(normalizedState) || !['MISSING', 'ERROR'].includes(normalizedState)) {
      throw new Error(`실패 상태로 사용할 수 없습니다: ${state}`);
    }
    const pName = normalizeProvider(provider);
    this.ensure({ sessionId, provider: pName });
    getDb().prepare(`UPDATE provider_sessions
      SET state = ?, last_error = ?, updated_at = datetime('now')
      WHERE session_id = ? AND provider = ?`)
      .run(normalizedState, String(error?.message || error || 'unknown provider session error').slice(0, 2000), sessionId, pName);
    return this.get(sessionId, pName);
  }

  static resetToUnbound({ sessionId, provider }) {
    const pName = normalizeProvider(provider);
    this.ensure({ sessionId, provider: pName });
    getDb().prepare(`UPDATE provider_sessions
      SET native_session_ref = NULL, state = 'UNBOUND', bound_at = NULL, last_verified_at = NULL,
          last_error = NULL, last_synced_message_id = NULL, updated_at = datetime('now')
      WHERE session_id = ? AND provider = ?`)
      .run(sessionId, pName);
    return this.get(sessionId, pName);
  }
}
