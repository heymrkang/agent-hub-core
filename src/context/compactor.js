import { providerManager } from '../providers/provider-manager.js';
import { SessionManager } from '../sessions/session-manager.js';
import { ProviderSessionRepository } from '../sessions/provider-session-repository.js';
import { ContextManager } from './context-manager.js';
import { JobRuntime } from '../jobs/job-runtime.js';
import { redactSecrets } from '../utils/redact.js';

const DEFAULT_TAIL_SIZE = 10;
const MIN_COMPACT_MESSAGES = 6;
const compactingSessions = new Set();

function countChars(value) {
  return String(value || '').length;
}

function formatMessages(messages) {
  return messages.map((message) => `[${message.role}]\n${redactSecrets(message.text)}`).join('\n\n');
}

function buildSummaryPrompt(existingSummary, messages) {
  return `아래는 Agent Hub 장기 대화 컨텍스트를 갱신하기 위한 내부 요약 작업이다.
한국어로 간결하지만 식별자와 결정 사항은 정확히 유지하라. 비밀값, 토큰, API Key, 암호, credential은 절대 출력하지 마라.

반드시 보존할 항목:
- 사용자의 목표와 확정된 결정
- 현재 작업 위치와 진행 상태
- 변경한 파일 및 중요한 구현 내용
- 검증 결과와 남은 문제
- 환경, 권한, 배포 제약
- 사용자 선호와 금지사항
- 정확히 유지해야 하는 식별자, 경로, 명령, 오류 핵심

기존 rolling summary:
${redactSecrets(existingSummary || '(없음)')}

새로 반영할 Canonical messages:
${formatMessages(messages)}

중복을 제거한 갱신 rolling summary만 출력하라.`;
}

export class Compactor {
  static isCompactingSession(sessionId) {
    return compactingSessions.has(sessionId);
  }

  /**
   * 활성 세션의 오래된 Canonical messages를 Agent Hub rolling summary로 압축한다.
   * @param {number} userId
   * @returns {Promise<{ status: string, success: boolean, message: string, beforeChars?: number, afterChars?: number }>}
   */
  static async compactActiveSession(userId) {
    const activeSession = SessionManager.getActiveSession(userId);
    return this.compactSession(activeSession.id);
  }

  static async compactSession(sessionId, { tailSize = DEFAULT_TAIL_SIZE, minMessages = MIN_COMPACT_MESSAGES } = {}) {
    if (this.isCompactingSession(sessionId)) return this.result('BUSY', false, '이미 이 세션의 컨텍스트를 압축 중입니다.');
    if (JobRuntime.getActiveJobForSession(sessionId)) return this.result('BUSY', false, '현재 세션에 실행 중이거나 대기 중인 작업이 있습니다.');

    compactingSessions.add(sessionId);
    try {
      const range = ContextManager.getCompactRange(sessionId, { tailSize });
      if (range.candidates.length < minMessages) {
        return this.result('NO_CHANGE', true, `압축할 신규 메시지가 부족합니다. (대상 ${range.candidates.length}개 / 최소 ${minMessages}개, 최근 원문 ${range.tail.length}개 유지)`);
      }

      const adapter = providerManager.getAdapter(range.session.active_provider);
      const prompt = buildSummaryPrompt(range.session.rolling_summary, range.candidates);
      const beforeChars = countChars(range.session.rolling_summary) + range.candidates.reduce((sum, row) => sum + countChars(row.text), 0);
      const response = await adapter.executePrompt({
        prompt,
        model: range.session.active_model,
        reasoningEffort: 'default',
        sessionId,
        profile: 'READ_ONLY'
      });
      const summary = redactSecrets(response?.response).trim();
      if (!summary) throw new Error('Provider가 빈 요약을 반환했습니다.');
      const afterChars = countChars(summary);
      const cursorMessageId = range.candidates.at(-1).id;

      ContextManager.commitCompact(sessionId, {
        expectedCursorMessageId: range.session.compact_cursor_message_id,
        rollingSummary: summary,
        cursorMessageId,
        beforeChars,
        afterChars
      });

      ProviderSessionRepository.resetAllToUnbound(sessionId);

      return {
        ...this.result('COMPACTED', true, `✅ **컨텍스트 압축 완료**\n\n• 압축 메시지: \`${range.candidates.length}개\`\n• 최근 원문 유지: \`${range.tail.length}개\`\n• 압축 전 추정 문자: \`${beforeChars}\`\n• 압축 후 추정 문자: \`${afterChars}\`\n• **Native Session**: \`초기화 완료 (다음 턴에서 압축본으로 새 세션 롤오버)\`\n\n_SQLite Canonical 원문은 삭제하거나 수정하지 않았습니다._`),
        compactedMessages: range.candidates.length,
        retainedMessages: range.tail.length,
        beforeChars,
        afterChars,
        cursorMessageId
      };
    } finally {
      compactingSessions.delete(sessionId);
    }
  }

  static result(status, success, message) {
    return { status, success, message };
  }
}
