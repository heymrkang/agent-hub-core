import { JobRuntime } from './job-runtime.js';
import { JobStatus, ErrorCategory } from './types.js';
import { providerManager } from '../providers/provider-manager.js';

class QueueManager {
  constructor() {
    // 세션별 큐: Map<sessionId, Array<QueueItem>>
    this.sessionQueues = new Map();

    // 프로바이더별 현재 실행 중인 작업 수: Map<providerName, number>
    this.providerRunningCounts = new Map();

    // 프로바이더별 최대 동시 실행 수
    this.providerConcurrencyLimits = new Map([
      ['codex', 2],
      ['gemini', 2]
    ]);

    // 활성 실행 객체 관리: Map<jobId, { abortController, startTime, intervalTimer, ... }>
    this.activeExecutions = new Map();
  }

  /**
   * 새 작업을 큐에 추가하고 스케줄링을 트리거한다.
   * @param {object} item
   * @returns {Promise<string>} response
   */
  async enqueueJob({ sessionId, sessionTitle, provider, model, prompt, profile, onStatusUpdate }) {
    const jobRecord = JobRuntime.createJob({
      sessionId,
      type: 'CHAT',
      provider,
      model
    });

    const abortController = new AbortController();

    const queueItem = {
      job: { ...jobRecord, sessionTitle },
      prompt,
      profile,
      abortController,
      onStatusUpdate,
      resolve: null,
      reject: null
    };

    const promise = new Promise((resolve, reject) => {
      queueItem.resolve = resolve;
      queueItem.reject = reject;
    });

    if (!this.sessionQueues.has(sessionId)) {
      this.sessionQueues.set(sessionId, []);
    }
    this.sessionQueues.get(sessionId).push(queueItem);

    if (onStatusUpdate) {
      onStatusUpdate(JobStatus.QUEUED, 0);
    }

    // 다음 작업 처리 시도
    this.processNext(provider);

    return promise;
  }

  /**
   * 특정 프로바이더의 큐에서 실행 가능한 다음 작업을 찾아 실행한다.
   * @param {string} providerName
   */
  processNext(providerName = 'codex') {
    const pName = providerName.toLowerCase();
    const currentRunning = this.providerRunningCounts.get(pName) || 0;
    const limit = this.providerConcurrencyLimits.get(pName) || 2;

    if (currentRunning >= limit) {
      // 프로바이더 동시성 한도 초과 -> 대기
      return;
    }

    // 각 세션 큐에서 첫 번째 항목 중 아직 실행 중이지 않은 세션의 작업 탐색
    for (const [sessionId, queue] of this.sessionQueues.entries()) {
      if (queue.length === 0) continue;

      const candidate = queue[0];
      if (candidate.job.provider.toLowerCase() !== pName) continue;

      // 이미 이 세션의 작업이 실행 중인지 확인
      const isSessionBusy = Array.from(this.activeExecutions.values()).some(
        (e) => e.sessionId === sessionId
      );
      if (isSessionBusy) {
        // 동일 세션 작업은 순차(FIFO) 실행
        continue;
      }

      // 실행 가능한 작업 선택
      queue.shift(); // 세션 큐에서 꺼냄
      if (queue.length === 0) {
        this.sessionQueues.delete(sessionId);
      }

      this.executeJobItem(candidate);
      break;
    }
  }

  /**
   * 실제 CLI 어댑터를 호출하여 작업을 실행한다.
   * @param {object} queueItem
   */
  async executeJobItem(queueItem) {
    const { job, prompt, profile, abortController, onStatusUpdate, resolve, reject } = queueItem;
    const providerName = job.provider.toLowerCase();

    // 동시성 카운트 증가
    const currentCount = this.providerRunningCounts.get(providerName) || 0;
    this.providerRunningCounts.set(providerName, currentCount + 1);

    const startTime = Date.now();
    JobRuntime.markRunning(job.id);

    // 실시간 상태 업데이트 타이머 (1초 주기)
    let elapsedSec = 0;
    const intervalTimer = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      if (onStatusUpdate) {
        onStatusUpdate(JobStatus.RUNNING, elapsedSec);
      }
    }, 1000);

    if (onStatusUpdate) {
      onStatusUpdate(JobStatus.RUNNING, 0);
    }

    this.activeExecutions.set(job.id, {
      sessionId: job.session_id,
      provider: providerName,
      abortController,
      intervalTimer,
      startTime
    });

    try {
      const adapter = providerManager.getAdapter(job.provider);
      const result = await adapter.executePrompt({
        prompt,
        model: job.model,
        sessionId: job.session_id,
        profile,
        signal: abortController.signal
      });

      clearInterval(intervalTimer);
      const durationMs = Date.now() - startTime;
      JobRuntime.markCompleted(job.id, durationMs);

      if (onStatusUpdate) {
        onStatusUpdate(JobStatus.COMPLETED, Math.floor(durationMs / 1000));
      }

      resolve(result.response);
    } catch (error) {
      clearInterval(intervalTimer);
      const durationMs = Date.now() - startTime;

      if (abortController.signal.aborted) {
        JobRuntime.markCancelled(job.id, durationMs);
        if (onStatusUpdate) {
          onStatusUpdate(JobStatus.CANCELLED, Math.floor(durationMs / 1000));
        }
        reject(new Error('작업이 취소되었습니다.'));
      } else {
        const errorCategory = error.message.includes('타임아웃')
          ? ErrorCategory.TIMEOUT
          : ErrorCategory.PROVIDER_EXEC;

        JobRuntime.markFailed(job.id, errorCategory, error.message, 1, durationMs);
        if (onStatusUpdate) {
          onStatusUpdate(JobStatus.FAILED, Math.floor(durationMs / 1000));
        }
        reject(error);
      }
    } finally {
      // 정리 및 다음 큐 실행
      this.activeExecutions.delete(job.id);
      const remainingCount = this.providerRunningCounts.get(providerName) || 1;
      this.providerRunningCounts.set(providerName, Math.max(0, remainingCount - 1));

      // 다음 대기 작업 처리
      this.processNext(providerName);
    }
  }

  /**
   * 실행 중이거나 대기 중인 특정 작업을 즉시 취소한다.
   * @param {string} jobId
   * @returns {boolean} 취소 성공 여부
   */
  cancelJob(jobId) {
    // 1. 현재 실행 중인 작업 취소
    const active = this.activeExecutions.get(jobId);
    if (active) {
      active.abortController.abort();
      return true;
    }

    // 2. 대기 큐에 있는 작업 취소
    for (const [sessionId, queue] of this.sessionQueues.entries()) {
      const idx = queue.findIndex((item) => item.job.id === jobId);
      if (idx !== -1) {
        const [removed] = queue.splice(idx, 1);
        JobRuntime.markCancelled(jobId);
        if (removed.onStatusUpdate) {
          removed.onStatusUpdate(JobStatus.CANCELLED, 0);
        }
        removed.reject(new Error('작업이 대기 중 취소되었습니다.'));
        if (queue.length === 0) {
          this.sessionQueues.delete(sessionId);
        }
        return true;
      }
    }

    return false;
  }

  /**
   * 특정 세션의 실행 중인 작업을 취소한다.
   * @param {string} sessionId
   */
  cancelActiveJobForSession(sessionId) {
    for (const [jobId, active] of this.activeExecutions.entries()) {
      if (active.sessionId === sessionId) {
        return this.cancelJob(jobId);
      }
    }
    // 대기 큐 확인
    const queue = this.sessionQueues.get(sessionId);
    if (queue && queue.length > 0) {
      return this.cancelJob(queue[0].job.id);
    }
    return false;
  }

  /**
   * 현재 큐 통계 정보를 반환한다.
   */
  getQueueStats() {
    let totalQueued = 0;
    for (const q of this.sessionQueues.values()) {
      totalQueued += q.length;
    }

    const running = {};
    for (const [p, c] of this.providerRunningCounts.entries()) {
      running[p] = c;
    }

    return {
      activeExecutionsCount: this.activeExecutions.size,
      totalQueued,
      providerRunning: running,
      providerLimits: Object.fromEntries(this.providerConcurrencyLimits)
    };
  }
}

export const queueManager = new QueueManager();
