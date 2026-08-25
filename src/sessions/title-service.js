import { SessionManager } from './session-manager.js';
import { getDb } from '../database/index.js';

export class TitleService {
  /**
   * 세션의 첫 대화 후 자동으로 세션 제목을 1회 생성한다.
   * @param {string} sessionId
   * @param {string} userPrompt
   * @param {string} assistantResponse
   */
  static async autoGenerateTitleIfEligible(sessionId, userPrompt, assistantResponse) {
    const db = getDb();
    const session = SessionManager.getSession(sessionId);

    if (!session) return;

    // 이미 사용자가 직접 변경했거나(title_locked = 1) 기본 제목이 아닌 경우 스킵
    if (session.title_locked === 1) {
      return;
    }

    // 메시지 개수 확인 (첫 번째 대화 쌍인 경우에만 생성)
    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
      .get(sessionId).count;

    if (msgCount > 2) {
      return;
    }

    try {
      // 프롬프트 기반으로 간결한 20자 이내의 제목 생성
      let generatedTitle = userPrompt
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 20);

      if (userPrompt.length > 20) {
        generatedTitle += '...';
      }

      if (!generatedTitle) {
        generatedTitle = '새 대화';
      }

      // DB 업데이트 (title_locked는 0으로 유지하여 추후 사용자가 /rename 가능)
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
