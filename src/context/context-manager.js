import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { SessionManager } from '../sessions/session-manager.js';

export class ContextManager {
  /**
   * 세션의 Canonical 원본 메시지 목록을 조회한다.
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Array<object>}
   */
  static getCanonicalMessages(sessionId, limit = 50) {
    return SessionManager.getRecentMessages(sessionId, limit);
  }

  /**
   * 세션의 요약 및 작업 컨텍스트 정보를 조회한다.
   */
  static getSessionContextInfo(sessionId) {
    const db = getDb();
    return db.prepare(`
      SELECT id, title, active_provider, active_model, execution_profile, rolling_summary, working_context
      FROM sessions WHERE id = ?
    `).get(sessionId) || null;
  }

  /**
   * 세션의 rolling_summary 및 working_context를 업데이트한다.
   */
  static updateSessionContextInfo(sessionId, { rollingSummary, workingContext }) {
    const db = getDb();
    db.prepare(`
      UPDATE sessions
      SET rolling_summary = COALESCE(?, rolling_summary),
          working_context = COALESCE(?, working_context),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(rollingSummary || null, workingContext || null, sessionId);
  }

  /**
   * 특정 프로바이더의 네이티브 세션 정보를 조회한다.
   */
  static getProviderSession(sessionId, provider) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM provider_sessions
      WHERE session_id = ? AND provider = ?
    `).get(sessionId, provider.toLowerCase()) || null;
  }

  /**
   * Provider 네이티브 세션 정보를 저장 또는 갱신한다.
   */
  static upsertProviderSession({ sessionId, provider, nativeSessionRef, lastSyncedMessageId }) {
    const db = getDb();
    const pName = provider.toLowerCase();
    const existing = this.getProviderSession(sessionId, pName);

    if (existing) {
      db.prepare(`
        UPDATE provider_sessions
        SET native_session_ref = COALESCE(?, native_session_ref),
            last_synced_message_id = COALESCE(?, last_synced_message_id),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(nativeSessionRef || null, lastSyncedMessageId || null, existing.id);
      return this.getProviderSession(sessionId, pName);
    } else {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO provider_sessions (id, session_id, provider, native_session_ref, last_synced_message_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, sessionId, pName, nativeSessionRef || null, lastSyncedMessageId || null);
      return this.getProviderSession(sessionId, pName);
    }
  }

  /**
   * Handoff 및 프롬프트 주입을 위한 통합 Context Package를 구성한다.
   * @param {string} sessionId
   * @param {string} fromMessageId 특정 메시지 이후 증분만 가져올 때 (Incremental)
   */
  static buildContextPackage(sessionId, fromMessageId = null) {
    const sessionInfo = this.getSessionContextInfo(sessionId);
    const db = getDb();

    let messages;
    if (fromMessageId) {
      // fromMessageId 이후의 메시지만 조회 (증분)
      const refMsg = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(fromMessageId);
      if (refMsg) {
        messages = db.prepare(`
          SELECT * FROM messages
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at ASC
        `).all(sessionId, refMsg.created_at);
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
