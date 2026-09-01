import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { SessionManager } from '../sessions/session-manager.js';

export class ContextManager {
  static getCanonicalMessages(sessionId, limit = 50) {
    return SessionManager.getRecentMessages(sessionId, limit);
  }

  static getSessionContextInfo(sessionId) {
    const db = getDb();
    return db.prepare(`SELECT id, title, active_provider, active_model, execution_profile, rolling_summary, working_context,
      compact_cursor_message_id, last_compacted_at, compact_before_chars, compact_after_chars
      FROM sessions WHERE id = ?`).get(sessionId) || null;
  }

  static getCompactRange(sessionId, { tailSize = 10 } = {}) {
    const db = getDb();
    const session = this.getSessionContextInfo(sessionId);
    if (!session) throw new Error('세션을 찾을 수 없습니다.');

    let cursorRowid = 0;
    if (session.compact_cursor_message_id) {
      const cursor = db.prepare('SELECT rowid AS cursor FROM messages WHERE id = ? AND session_id = ?')
        .get(session.compact_cursor_message_id, sessionId);
      if (!cursor) throw new Error('저장된 Compact cursor가 현재 세션의 Canonical message를 가리키지 않습니다.');
      cursorRowid = cursor.cursor;
    }

    const pending = db.prepare(`SELECT rowid AS canonical_order, * FROM messages
      WHERE session_id = ? AND rowid > ? ORDER BY rowid ASC`).all(sessionId, cursorRowid);
    const candidateCount = Math.max(0, pending.length - tailSize);
    return {
      session,
      candidates: pending.slice(0, candidateCount),
      tail: pending.slice(candidateCount)
    };
  }

  static commitCompact(sessionId, { expectedCursorMessageId, rollingSummary, cursorMessageId, beforeChars, afterChars }) {
    const db = getDb();
    const commit = db.transaction(() => {
      const session = db.prepare('SELECT compact_cursor_message_id FROM sessions WHERE id = ?').get(sessionId);
      if (!session) throw new Error('세션을 찾을 수 없습니다.');
      if ((session.compact_cursor_message_id || null) !== (expectedCursorMessageId || null)) {
        const error = new Error('Compact 상태가 실행 중 변경되었습니다. 다시 시도하세요.');
        error.code = 'COMPACT_CONFLICT';
        throw error;
      }
      const cursor = db.prepare('SELECT id FROM messages WHERE id = ? AND session_id = ?').get(cursorMessageId, sessionId);
      if (!cursor) throw new Error('Compact cursor 대상이 현재 세션에 없습니다.');
      db.prepare(`UPDATE sessions SET rolling_summary = ?, compact_cursor_message_id = ?,
        last_compacted_at = datetime('now'), compact_before_chars = ?, compact_after_chars = ?,
        updated_at = datetime('now') WHERE id = ?`)
        .run(rollingSummary, cursorMessageId, beforeChars, afterChars, sessionId);
    });
    commit();
    return this.getSessionContextInfo(sessionId);
  }

  static updateSessionContextInfo(sessionId, { rollingSummary, workingContext }) {
    const db = getDb();
    db.prepare(`UPDATE sessions SET rolling_summary = COALESCE(?, rolling_summary), working_context = COALESCE(?, working_context), updated_at = datetime('now') WHERE id = ?`)
      .run(rollingSummary || null, workingContext || null, sessionId);
  }

  static getProviderSession(sessionId, provider) {
    return getDb().prepare(`SELECT * FROM provider_sessions WHERE session_id = ? AND provider = ?`).get(sessionId, provider.toLowerCase()) || null;
  }

  static upsertProviderSession({ sessionId, provider, nativeSessionRef, lastSyncedMessageId }) {
    const db = getDb();
    const pName = provider.toLowerCase();
    const existing = this.getProviderSession(sessionId, pName);
    if (existing) {
      db.prepare(`UPDATE provider_sessions SET native_session_ref = COALESCE(?, native_session_ref), last_synced_message_id = COALESCE(?, last_synced_message_id), updated_at = datetime('now') WHERE id = ?`)
        .run(nativeSessionRef || null, lastSyncedMessageId || null, existing.id);
    } else {
      db.prepare(`INSERT INTO provider_sessions (id, session_id, provider, native_session_ref, last_synced_message_id) VALUES (?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), sessionId, pName, nativeSessionRef || null, lastSyncedMessageId || null);
    }
    return this.getProviderSession(sessionId, pName);
  }

  static buildContextPackage(sessionId, fromMessageId = null) {
    const sessionInfo = this.getSessionContextInfo(sessionId);
    const db = getDb();
    let messages;

    if (fromMessageId) {
      // UUID/timestamp 비교 대신 SQLite rowid를 cursor로 사용해 같은 초 메시지 누락을 방지한다.
      const refMsg = db.prepare('SELECT rowid AS cursor FROM messages WHERE id = ? AND session_id = ?').get(fromMessageId, sessionId);
      if (refMsg) {
        messages = db.prepare(`SELECT * FROM messages WHERE session_id = ? AND rowid > ? ORDER BY rowid ASC`).all(sessionId, refMsg.cursor);
      } else {
        messages = this.getCanonicalMessages(sessionId, 30);
      }
    } else {
      messages = this.getCanonicalMessages(sessionId, 30);
    }

    return {
      sessionId,
      sessionTitle: sessionInfo?.title || '세션',
      rollingSummary: sessionInfo?.rolling_summary || null,
      workingContext: sessionInfo?.working_context || null,
      messages,
      totalMessageCount: messages.length,
      latestMessageId: messages.length > 0 ? messages[messages.length - 1].id : null
    };
  }
}
