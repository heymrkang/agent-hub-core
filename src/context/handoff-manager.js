import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { ContextManager } from './context-manager.js';
import { providerManager } from '../providers/provider-manager.js';

export class HandoffManager {
  static async executeHandoff({ sessionId, fromProvider, toProvider, targetModel = null }) {
    const db = getDb();
    const handoffId = crypto.randomUUID();
    const fromP = fromProvider.toLowerCase();
    const toP = toProvider.toLowerCase();

    if (fromP === toP) {
      db.prepare(`UPDATE sessions SET active_model = ?, updated_at = datetime('now') WHERE id = ?`).run(targetModel, sessionId);
      return { success: true, isSameProvider: true };
    }

    const targetAdapter = providerManager.getAdapter(toP);
    const health = await targetAdapter.checkHealth();
    if (!health.healthy) {
      const errMsg = `대상 Provider [${toP}] 가 현재 비정상 상태입니다: ${health.error}`;
      this.recordHandoffFailure(handoffId, sessionId, fromP, toP, errMsg);
      throw new Error(errMsg);
    }

    const existingTargetSession = ContextManager.getProviderSession(sessionId, toP);
    const contextPackage = ContextManager.buildContextPackage(sessionId, existingTargetSession?.last_synced_message_id || null);
    const payloadSummary = JSON.stringify({
      mode: existingTargetSession?.last_synced_message_id ? 'INCREMENTAL_ON_NEXT_EXECUTION' : 'CANONICAL_ON_NEXT_EXECUTION',
      messageCount: contextPackage.totalMessageCount,
      hasSummary: Boolean(contextPackage.rollingSummary),
      nativeSessionAvailable: Boolean(existingTargetSession?.native_session_ref)
    });

    db.prepare(`INSERT INTO provider_handoffs (id, session_id, from_provider, to_provider, handoff_payload, status) VALUES (?, ?, ?, ?, ?, 'PENDING')`)
      .run(handoffId, sessionId, fromP, toP, payloadSummary);

    try {
      // Provider 선택 자체는 원자적으로 바꾸되, sync cursor는 여기서 절대 갱신하지 않는다.
      // 실제 대상 Provider 실행 성공 후 QueueManager가 cursor/native ref를 저장한다.
      db.transaction(() => {
        db.prepare(`UPDATE sessions SET active_provider = ?, active_model = ?, updated_at = datetime('now') WHERE id = ?`).run(toP, targetModel, sessionId);
        db.prepare(`UPDATE provider_handoffs SET status = 'SUCCESS' WHERE id = ?`).run(handoffId);
      })();
      return { success: true, isIncremental: Boolean(existingTargetSession?.last_synced_message_id), messageCount: contextPackage.totalMessageCount };
    } catch (err) {
      this.recordHandoffFailure(handoffId, sessionId, fromP, toP, err.message);
      throw new Error(`Provider 전환 실패 (기존 ${fromP} 유지됨): ${err.message}`);
    }
  }

  static recordHandoffFailure(handoffId, sessionId, fromP, toP, errMsg) {
    try {
      getDb().prepare(`INSERT INTO provider_handoffs (id, session_id, from_provider, to_provider, status, error_message) VALUES (?, ?, ?, ?, 'FAILED', ?) ON CONFLICT(id) DO UPDATE SET status = 'FAILED', error_message = excluded.error_message`)
        .run(handoffId, sessionId, fromP, toP, errMsg);
    } catch {}
  }
}
