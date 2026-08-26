import crypto from 'crypto';
import { getDb } from '../database/index.js';

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
    const profile = options.profile || 'WORKSPACE';
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

  static listSessions(userId, status = 'ACTIVE') {
    return getDb().prepare('SELECT * FROM sessions WHERE user_id=? AND status=? AND is_system=0 ORDER BY updated_at DESC').all(userId, status);
  }

  static renameSession(sessionId, newTitle) {
    const r = getDb().prepare(`UPDATE sessions SET title=?,title_locked=1,updated_at=datetime('now') WHERE id=? AND is_system=0`).run(newTitle, sessionId);
    if (!r.changes) throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);
  }
  static archiveSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='ARCHIVED',updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }
  static softDeleteSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='DELETED',deleted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }
  static restoreSession(sessionId) { getDb().prepare(`UPDATE sessions SET status='ACTIVE',deleted_at=NULL,updated_at=datetime('now') WHERE id=? AND is_system=0`).run(sessionId); }

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
