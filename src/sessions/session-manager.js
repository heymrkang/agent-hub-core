import crypto from 'crypto';
import { getDb } from '../database/index.js';

export class SessionManager {
  /**
   * 사용자가 존재하지 않으면 DB에 생성한다.
   * @param {number} userId Telegram Numeric User ID
   * @param {string} role 'OWNER'
   */
  static ensureUser(userId, role = 'OWNER') {
    const db = getDb();
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!existing) {
      db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(userId, role);
      console.log(`[SessionManager] 신규 사용자 등록: UserID=${userId}, Role=${role}`);
    }
  }

  /**
   * 새 세션을 생성하고 활성 세션으로 설정한다.
   * @param {number} userId
   * @param {object} options
   * @returns {object} 생성된 세션 객체
   */
  static createSession(userId, options = {}) {
    const db = getDb();
    this.ensureUser(userId);

    const sessionId = crypto.randomUUID();
    const title = options.title || '새 채팅';
    const provider = options.provider || 'codex';
    const model = options.model || null;
    const profile = options.profile || 'WORKSPACE';

    const insertStmt = db.prepare(`
      INSERT INTO sessions (id, user_id, title, title_locked, active_provider, active_model, execution_profile, status)
      VALUES (?, ?, ?, 0, ?, ?, ?, 'ACTIVE')
    `);

    insertStmt.run(sessionId, userId, title, provider, model, profile);

    // 사용자의 활성 세션 설정
    this.setActiveSession(userId, sessionId);

    return this.getSession(sessionId);
  }

  /**
   * 특정 세션을 ID로 조회한다.
   * @param {string} sessionId
   * @returns {object|null}
   */
  static getSession(sessionId) {
    const db = getDb();
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) || null;
  }

  /**
   * 사용자의 현재 활성 세션을 조회한다. 없으면 기본 세션을 생성하여 반환한다.
   * @param {number} userId
   * @returns {object}
   */
  static getActiveSession(userId) {
    const db = getDb();
    this.ensureUser(userId);

    const settingKey = `active_session_${userId}`;
    const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey);

    if (settingRow && settingRow.value) {
      const activeSession = this.getSession(settingRow.value);
      if (activeSession && activeSession.status === 'ACTIVE') {
        return activeSession;
      }
    }

    // 활성 세션이 없거나 삭제/보관된 경우, 가장 최근 ACTIVE 세션을 찾음
    const latestActive = db
      .prepare("SELECT * FROM sessions WHERE user_id = ? AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1")
      .get(userId);

    if (latestActive) {
      this.setActiveSession(userId, latestActive.id);
      return latestActive;
    }

    // ACTIVE 세션이 아예 없으면 새로 생성
    return this.createSession(userId);
  }

  /**
   * 사용자의 활성 세션을 변경한다.
   * @param {number} userId
   * @param {string} sessionId
   */
  static setActiveSession(userId, sessionId) {
    const db = getDb();
    const settingKey = `active_session_${userId}`;
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(settingKey, sessionId);
  }

  /**
   * 사용자의 세션 목록을 상태별로 조회한다.
   * @param {number} userId
   * @param {string} status 'ACTIVE' | 'ARCHIVED' | 'DELETED'
   * @returns {Array<object>}
   */
  static listSessions(userId, status = 'ACTIVE') {
    const db = getDb();
    return db
      .prepare('SELECT * FROM sessions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC')
      .all(userId, status);
  }

  /**
   * 세션 제목을 수동으로 변경하고 title_locked = 1로 잠근다.
   * @param {string} sessionId
   * @param {string} newTitle
   */
  static renameSession(sessionId, newTitle) {
    const db = getDb();
    const result = db.prepare(`
      UPDATE sessions
      SET title = ?, title_locked = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(newTitle, sessionId);

    if (result.changes === 0) {
      throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);
    }
  }

  /**
   * 세션을 보관(Archive) 처리한다.
   * @param {string} sessionId
   */
  static archiveSession(sessionId) {
    const db = getDb();
    db.prepare(`
      UPDATE sessions
      SET status = 'ARCHIVED', updated_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
  }

  /**
   * 세션을 소프트 삭제(Soft Delete)한다 (30일 보존).
   * @param {string} sessionId
   */
  static softDeleteSession(sessionId) {
    const db = getDb();
    db.prepare(`
      UPDATE sessions
      SET status = 'DELETED', deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
  }

  /**
   * 소프트 삭제되거나 보관된 세션을 활성 상태로 복구한다.
   * @param {string} sessionId
   */
  static restoreSession(sessionId) {
    const db = getDb();
    db.prepare(`
      UPDATE sessions
      SET status = 'ACTIVE', deleted_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
  }

  /**
   * 메시지를 SQLite Canonical DB에 영속화한다.
   * @param {object} param0
   * @returns {string} messageId
   */
  static saveMessage({ sessionId, role, text, provider = null, model = null }) {
    const db = getDb();
    const messageId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO messages (id, session_id, role, text, provider, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(messageId, sessionId, role, text, provider, model);

    // 세션의 updated_at 갱신
    db.prepare(`
      UPDATE sessions
      SET updated_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);

    return messageId;
  }

  /**
   * 특정 세션의 최근 메시지 목록을 조회한다.
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Array<object>}
   */
  static getRecentMessages(sessionId, limit = 50) {
    const db = getDb();
    return db
      .prepare(`
        SELECT * FROM (
          SELECT * FROM messages
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        ) ORDER BY created_at ASC
      `)
      .all(sessionId, limit);
  }
}
