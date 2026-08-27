import crypto from 'crypto';
import fs from 'fs';
import { getDb } from '../database/index.js';

const EXECUTION_PROFILES = new Set(['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS']);

export class SessionManager {
  static ensureUser(userId, role = 'OWNER') {
    const db = getDb();
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!existing) {
      db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(userId, role);
      console.log(`[SessionManager] 신규 사용자 등록: UserID=${userId}, Role=${role}`);
    }
  }

  static createSession(userId, options = {}) {
    const db = getDb();
    this.ensureUser(userId);
    const sessionId = crypto.randomUUID();
    const title = options.title || '새 채팅';
    const provider = options.provider || 'codex';
    const model = options.model || null;
    const profile = EXECUTION_PROFILES.has(options.profile) ? options.profile : 'WORKSPACE';
    const isSystem = options.isSystem ? 1 : 0;
    const status = options.status || (isSystem ? 'ARCHIVED' : 'ACTIVE');
    db.prepare(`INSERT INTO sessions (id,user_id,title,title_locked,active_provider,active_model,execution_profile,status,is_system) VALUES (?,?,?,0,?,?,?,?,?)`)
      .run(sessionId, userId, title, provider, model, profile, status, isSystem);
    if (!isSystem) this.setActiveSession(userId, sessionId);
    return this.getSession(sessionId);
  }

  static getSession(sessionId) { return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) || null; }

  static getActiveSession(userId) {
    const db = getDb();
    this.ensureUser(userId);
    const settingKey = `active_session_${userId}`;
    const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey);
    if (settingRow?.value) {
      const session = this.getSession(settingRow.value);
      if (session && session.status === 'ACTIVE' && !session.is_system) return session;
    }
    const latest = db.prepare("SELECT * FROM sessions WHERE user_id=? AND status='ACTIVE' AND is_system=0 ORDER BY updated_at DESC LIMIT 1").get(userId);
    if (latest) { this.setActiveSession(userId, latest.id); return latest; }
    return this.createSession(userId);
  }

  static setActiveSession(userId, sessionId) {
    const db = getDb();
    const session = this.getSession(sessionId);
    if (!session || session.is_system) throw new Error('시스템 실행 세션은 활성 세션으로 선택할 수 없습니다.');
    const key = `active_session_${userId}`;
    db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, sessionId);
  }

  static setExecutionProfile(sessionId, profile) {
    const normalized = String(profile || '').toUpperCase();
    if (!EXECUTION_PROFILES.has(normalized)) throw new Error(`지원하지 않는 Execution Profile: ${profile}`);
    const result = getDb().prepare(`UPDATE sessions SET execution_profile=?,updated_at=datetime('now') WHERE id=? AND is_system=0`).run(normalized, sessionId);
    if (!result.changes) throw new Error('세션을 찾을 수 없습니다.');
    return this.getSession(sessionId);
  }

  static listSessions(userId, status = 'ACTIVE') {
    return getDb().prepare('SELECT * FROM sessions WHERE user_id=? AND status=? AND is_system=0 ORDER BY updated_at DESC').all(userId, status);
  }

  static countSessions(userId, status = 'ACTIVE') {
    return getDb().prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND status=? AND is_system=0').get(userId, status)?.count || 0;
  }

  static renameSession(sessionId, newTitle) {
    const r = getDb().prepare(`UPDATE sessions SET title=?,title_locked=1,updated_at=datetime('now') WHERE id=? AND is_system=0`).run(newTitle, sessionId);
    if (!r.changes) throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);
  }
  static archiveSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='ARCHIVED',updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }
  static softDeleteSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='DELETED',deleted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }
  static restoreSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='ACTIVE',deleted_at=NULL,updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }

  static _removeAttachmentFiles(rows) {
    for (const row of rows) {
      if (!row?.local_path) continue;
      try {
        if (fs.existsSync(row.local_path)) fs.unlinkSync(row.local_path);
      } catch (error) {
        console.warn(`[SessionManager] 첨부파일 삭제 실패: ${row.local_path}: ${error.message}`);
      }
    }
  }

  static permanentlyDeleteSession(userId, sessionId) {
    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE id=? AND user_id=? AND status='DELETED' AND is_system=0").get(sessionId, userId);
    if (!session) throw new Error('휴지통에서 삭제할 세션을 찾을 수 없습니다.');

    const attachments = db.prepare('SELECT local_path FROM attachments WHERE session_id=?').all(sessionId);
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM attachments WHERE session_id=?').run(sessionId);
      db.prepare('DELETE FROM jobs WHERE session_id=?').run(sessionId);
      db.prepare('DELETE FROM messages WHERE session_id=?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
    });
    remove();
    this._removeAttachmentFiles(attachments);
    return 1;
  }

  static emptyTrash(userId) {
    const db = getDb();
    const sessions = db.prepare("SELECT id FROM sessions WHERE user_id=? AND status='DELETED' AND is_system=0").all(userId);
    if (!sessions.length) return 0;

    const ids = sessions.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const attachments = db.prepare(`SELECT local_path FROM attachments WHERE session_id IN (${placeholders})`).all(...ids);
    const remove = db.transaction(() => {
      db.prepare(`DELETE FROM attachments WHERE session_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM jobs WHERE session_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM messages WHERE session_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);
    });
    remove();
    this._removeAttachmentFiles(attachments);
    return ids.length;
  }

  static saveMessage({ sessionId, role, text, provider = null, model = null }) {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO messages(id,session_id,role,text,provider,model,created_at) VALUES(?,?,?,?,?,?,datetime('now'))`).run(id, sessionId, role, text, provider, model);
    db.prepare(`UPDATE sessions SET updated_at=datetime('now') WHERE id=?`).run(sessionId);
    return id;
  }

  static getRecentMessages(sessionId, limit = 50) {
    return getDb().prepare(`SELECT * FROM (SELECT * FROM messages WHERE session_id=? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC`).all(sessionId, limit);
  }
}

export { EXECUTION_PROFILES };
