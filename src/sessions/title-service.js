import { SessionManager } from './session-manager.js';
import { getDb } from '../database/index.js';
import { getSettingsManager } from '../settings/settings-manager.js';

export class TitleService {
  /**
   * 세션의 첫 대화 후 자동으로 세션 제목을 1회 생성한다.
   * Phase 10 auto_session_title 설정이 OFF면 즉시 스킵한다.
   */
  static async autoGenerateTitleIfEligible(sessionId, userPrompt, assistantResponse) {
    try {
      if (!getSettingsManager().get('auto_session_title')) return;
    } catch {
      // Settings 초기화 이전 호출 등 예외 상황에서는 기존 동작을 유지한다.
    }

    const db = getDb();
    const session = SessionManager.getSession(sessionId);
    if (!session) return;
    if (session.title_locked === 1) return;

    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
      .get(sessionId).count;
    if (msgCount > 2) return;

    try {
      let generatedTitle = userPrompt.replace(/[\r\n]+/g, ' ').trim().slice(0, 20);
      if (userPrompt.length > 20) generatedTitle += '...';
      if (!generatedTitle) generatedTitle = '새 대화';

      db.prepare(`
        UPDATE sessions
        SET title = ?, updated_at = datetime('now')
        WHERE id = ? AND title_locked = 0
      `).run(generatedTitle, sessionId);

      console.log(`[TitleService] 세션 [${sessionId}] 자동 제목 생성: "${generatedTitle}"`);
    } catch (error) {
      console.error(`[TitleService Error] 세션 제목 자동 생성 실패: ${error.message}`);
    }
  }
}
