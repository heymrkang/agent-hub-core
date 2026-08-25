import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { JobStatus, ErrorCategory } from './types.js';

export class JobRuntime {
  /**
   * DB에 신규 Job을 생성한다.
   */
  static createJob({ sessionId, type = 'CHAT', provider = 'codex', model = null }) {
    const db = getDb();
    const jobId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO jobs (id, session_id, type, provider, model, status, queued_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(jobId, sessionId, type, provider, model, JobStatus.QUEUED);

    return this.getJob(jobId);
  }

  /**
   * Job 정보를 ID로 조회한다.
   */
  static getJob(jobId) {
    const db = getDb();
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) || null;
  }

  /**
   * Job 상태를 RUNNING으로 전환한다.
   */
  static markRunning(jobId) {
    const db = getDb();
    db.prepare(`
      UPDATE jobs
      SET status = ?, started_at = datetime('now')
      WHERE id = ?
    `).run(JobStatus.RUNNING, jobId);
  }

  /**
   * Job을 정상 완료(COMPLETED) 처리한다.
   */
  static markCompleted(jobId, durationMs) {
    const db = getDb();
    db.prepare(`
      UPDATE jobs
      SET status = ?, ended_at = datetime('now'), duration_ms = ?, exit_code = 0
      WHERE id = ?
    `).run(JobStatus.COMPLETED, durationMs, jobId);
  }

  /**
   * Job을 실패(FAILED) 처리한다.
   */
  static markFailed(jobId, errorCategory, errorMessage, exitCode = 1, durationMs = null) {
    const db = getDb();
    db.prepare(`
      UPDATE jobs
      SET status = ?, error_category = ?, error_message = ?, exit_code = ?, ended_at = datetime('now'), duration_ms = ?
      WHERE id = ?
    `).run(JobStatus.FAILED, errorCategory, errorMessage, exitCode, durationMs, jobId);
  }

  /**
   * Job을 취소(CANCELLED) 처리한다.
   */
  static markCancelled(jobId, durationMs = null) {
    const db = getDb();
    db.prepare(`
      UPDATE jobs
      SET status = ?, error_category = ?, error_message = '작업이 취소되었습니다.', ended_at = datetime('now'), duration_ms = ?
      WHERE id = ?
    `).run(JobStatus.CANCELLED, ErrorCategory.CANCELLED, durationMs, jobId);
  }

  /**
   * 서버 재시작 시 남아있는 RUNNING 작업들을 INTERRUPTED로 일괄 복구 처리한다.
   */
  static recoverInterruptedJobs() {
    const db = getDb();
    const result = db.prepare(`
      UPDATE jobs
      SET status = ?, error_category = ?, error_message = '서버 재시작으로 인해 작업이 중단되었습니다.', ended_at = datetime('now')
      WHERE status = ?
    `).run(JobStatus.INTERRUPTED, ErrorCategory.AGENT_HUB_RESTART, JobStatus.RUNNING);

    if (result.changes > 0) {
      console.log(`[JobRuntime] 재시작 복구: ${result.changes}개의 미완료 작업 -> INTERRUPTED 전환 완료.`);
    }
  }

  /**
   * 특정 세션의 가장 최근 실행 중이거나 대기 중인 Job을 조회한다.
   */
  static getActiveJobForSession(sessionId) {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM jobs
      WHERE session_id = ? AND (status = 'RUNNING' OR status = 'QUEUED')
      ORDER BY queued_at DESC LIMIT 1
    `).get(sessionId) || null;
  }
}
