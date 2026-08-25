import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { ContextManager } from './context-manager.js';
import { providerManager } from '../providers/provider-manager.js';

export class HandoffManager {
  /**
   * 프로바이더 간 트랜잭션 Context Handoff를 수행한다.
   * @param {object} param0 { sessionId, fromProvider, toProvider, targetModel }
   */
  static async executeHandoff({ sessionId, fromProvider, toProvider, targetModel = null }) {
    const db = getDb();
    const handoffId = crypto.randomUUID();
    const fromP = fromProvider.toLowerCase();
    const toP = toProvider.toLowerCase();

    if (fromP === toP) {
      // 동일 프로바이더 내 모델 변경인 경우 handoff 불필요
      db.prepare(`
        UPDATE sessions
        SET active_model = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(targetModel, sessionId);
      return { success: true, isSameProvider: true };
    }

    console.log(`[HandoffManager] Handoff 시작: Session [${sessionId}] (${fromP} -> ${toP})`);

    // 1. 대상 프로바이더 어댑터 헬스 점검
    const targetAdapter = providerManager.getAdapter(toP);
    const health = await targetAdapter.checkHealth();
    if (!health.healthy) {
      const errMsg = `대상 Provider [${toP}] 가 현재 비정상 상태입니다: ${health.error}`;
      this.recordHandoffFailure(handoffId, sessionId, fromP, toP, errMsg);
      throw new Error(errMsg);
    }

    // 2. 대상 프로바이더의 기존 네이티브 세션 확인 (Incremental 복귀 지원)
    const existingTargetSession = ContextManager.getProviderSession(sessionId, toP);
    const isIncremental = Boolean(existingTargetSession && existingTargetSession.last_synced_message_id);

    // 3. Handoff 패키지 빌드
    const contextPackage = ContextManager.buildContextPackage(
      sessionId,
      isIncremental ? existingTargetSession.last_synced_message_id : null
    );

    const payloadSummary = JSON.stringify({
      isIncremental,
      messageCount: contextPackage.totalMessageCount,
      hasSummary: Boolean(contextPackage.rollingSummary)
    });

    // 4. Handoff 레코드 생성 (PENDING)
    db.prepare(`
      INSERT INTO provider_handoffs (id, session_id, from_provider, to_provider, handoff_payload, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `).run(handoffId, sessionId, fromP, toP, payloadSummary);

    try {
      // 5. 트랜잭션 전환 적용 (성공 시에만 active_provider 변경)
      const handoffTx = db.transaction(() => {
        // 활성 세션 정보 갱신
        db.prepare(`
          UPDATE sessions
          SET active_provider = ?, active_model = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(toP, targetModel, sessionId);

        // 대상 프로바이더의 네이티브 세션 동기화 위치 갱신
        ContextManager.upsertProviderSession({
          sessionId,
          provider: toP,
          lastSyncedMessageId: contextPackage.latestMessageId
        });

        // Handoff 상태 SUCCESS 기록
        db.prepare(`
          UPDATE provider_handoffs
          SET status = 'SUCCESS'
          WHERE id = ?
        `).run(handoffId);
      });

      handoffTx();

      console.log(`[HandoffManager] Handoff 성공: Session [${sessionId}] -> ${toP} (${isIncremental ? '증분 복귀' : '전체 이전'})`);
      return {
        success: true,
        isIncremental,
        messageCount: contextPackage.totalMessageCount
      };
    } catch (err) {
      console.error(`[HandoffManager Error] Handoff 트랜잭션 실패: ${err.message}`);
      this.recordHandoffFailure(handoffId, sessionId, fromP, toP, err.message);
      throw new Error(`Provider 전환 실패 (기존 ${fromP} 유지됨): ${err.message}`);
    }
  }

  static recordHandoffFailure(handoffId, sessionId, fromP, toP, errMsg) {
    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO provider_handoffs (id, session_id, from_provider, to_provider, status, error_message)
        VALUES (?, ?, ?, ?, 'FAILED', ?)
        ON CONFLICT(id) DO UPDATE SET status = 'FAILED', error_message = excluded.error_message
      `).run(handoffId, sessionId, fromP, toP, errMsg);
    } catch {}
  }
}
