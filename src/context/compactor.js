import { providerManager } from '../providers/provider-manager.js';
import { SessionManager } from '../sessions/session-manager.js';

export class Compactor {
  /**
   * 활성 세션에 대해 Provider Native Compact를 실행한다.
   * @param {number} userId
   * @returns {Promise<{ success: boolean, message: string, beforeTokens?: number, afterTokens?: number }>}
   */
  static async compactActiveSession(userId) {
    const activeSession = SessionManager.getActiveSession(userId);
    const adapter = providerManager.getAdapter(activeSession.active_provider);

    // Provider Native Compact 호출
    const result = await adapter.compact({
      sessionId: activeSession.id,
      model: activeSession.active_model
    });

    if (!result.success) {
      return {
        success: false,
        message: `⚠️ **[${activeSession.active_provider.toUpperCase()}]** 프로바이더는 Native Compact 기능을 지원하지 않습니다 (\`UNSUPPORTED\`).\n\n_Agent Hub는 원본 Canonical 대화 기록을 안전하게 보존하며, 가짜 압축 지표를 생성하지 않습니다._`
      };
    }

    let msg = `✅ **[${activeSession.active_provider.toUpperCase()}] 컨텍스트 압축 완료**\n\n`;
    if (result.beforeTokens !== undefined && result.afterTokens !== undefined) {
      msg += `• 압축 전 토큰: \`${result.beforeTokens}\`\n`;
      msg += `• 압축 후 토큰: \`${result.afterTokens}\`\n`;
    } else {
      msg += `• 압축 결과: ${result.message || '정상 완료'}\n`;
    }
    msg += `\n_SQLite 내 Canonical 전체 대화 내역은 영구 보존됩니다._`;

    return {
      success: true,
      message: msg,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens
    };
  }
}
