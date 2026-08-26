import { JobRuntime } from './job-runtime.js';
import { JobStatus, ErrorCategory } from './types.js';
import { providerManager } from '../providers/provider-manager.js';
import { ContextManager } from '../context/context-manager.js';

class QueueManager {
  constructor() {
    this.sessionQueues = new Map();
    this.providerRunningCounts = new Map();
    this.providerConcurrencyLimits = new Map([
      ['codex', parseInt(process.env.CODEX_CONCURRENCY || '2', 10)],
      ['antigravity', parseInt(process.env.ANTIGRAVITY_CONCURRENCY || '2', 10)]
    ]);
    this.activeExecutions = new Map();
  }

  async enqueueJob({ sessionId, sessionTitle, provider, model, prompt, profile, onStatusUpdate }) {
    const jobRecord = JobRuntime.createJob({ sessionId, type: 'CHAT', provider, model });
    const abortController = new AbortController();
    const queueItem = { job: { ...jobRecord, sessionTitle }, prompt, profile, abortController, onStatusUpdate, resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => { queueItem.resolve = resolve; queueItem.reject = reject; });
    if (!this.sessionQueues.has(sessionId)) this.sessionQueues.set(sessionId, []);
    this.sessionQueues.get(sessionId).push(queueItem);
    if (onStatusUpdate) onStatusUpdate(JobStatus.QUEUED, 0);
    this.processNext(provider);
    return promise;
  }

  processNext(providerName = 'codex') {
    const pName = providerName.toLowerCase();
    const currentRunning = this.providerRunningCounts.get(pName) || 0;
    const limit = this.providerConcurrencyLimits.get(pName) || 2;
    if (currentRunning >= limit) return;

    for (const [sessionId, queue] of this.sessionQueues.entries()) {
      if (queue.length === 0) continue;
      const candidate = queue[0];
      if (candidate.job.provider.toLowerCase() !== pName) continue;
      const isSessionBusy = Array.from(this.activeExecutions.values()).some((e) => e.sessionId === sessionId);
      if (isSessionBusy) continue;
      queue.shift();
      if (queue.length === 0) this.sessionQueues.delete(sessionId);
      this.executeJobItem(candidate);
      break;
    }
  }

  async executeJobItem(queueItem) {
    const { job, prompt, profile, abortController, onStatusUpdate, resolve, reject } = queueItem;
    const providerName = job.provider.toLowerCase();
    this.providerRunningCounts.set(providerName, (this.providerRunningCounts.get(providerName) || 0) + 1);

    const startTime = Date.now();
    JobRuntime.markRunning(job.id);
    const intervalTimer = setInterval(() => {
      if (onStatusUpdate) onStatusUpdate(JobStatus.RUNNING, Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    if (onStatusUpdate) onStatusUpdate(JobStatus.RUNNING, 0);
    this.activeExecutions.set(job.id, { sessionId: job.session_id, provider: providerName, abortController, intervalTimer, startTime });

    try {
      const adapter = providerManager.getAdapter(job.provider);
      const providerSession = ContextManager.getProviderSession(job.session_id, providerName);
      const result = await adapter.executePrompt({
        prompt,
        model: job.model,
        sessionId: job.session_id,
        nativeSessionRef: providerSession?.native_session_ref || null,
        profile,
        signal: abortController.signal
      });

      if (result.nativeSessionRef) {
        ContextManager.upsertProviderSession({ sessionId: job.session_id, provider: providerName, nativeSessionRef: result.nativeSessionRef });
      }

      clearInterval(intervalTimer);
      const durationMs = Date.now() - startTime;
      JobRuntime.markCompleted(job.id, durationMs);
      if (onStatusUpdate) onStatusUpdate(JobStatus.COMPLETED, Math.floor(durationMs / 1000));
      resolve(result.response);
    } catch (error) {
      clearInterval(intervalTimer);
      const durationMs = Date.now() - startTime;
      if (abortController.signal.aborted) {
        JobRuntime.markCancelled(job.id, durationMs);
        if (onStatusUpdate) onStatusUpdate(JobStatus.CANCELLED, Math.floor(durationMs / 1000));
        reject(new Error('작업이 취소되었습니다.'));
      } else {
        const errorCategory = error.message.includes('타임아웃') ? ErrorCategory.TIMEOUT : ErrorCategory.PROVIDER_EXEC;
        JobRuntime.markFailed(job.id, errorCategory, error.message, 1, durationMs);
        if (onStatusUpdate) onStatusUpdate(JobStatus.FAILED, Math.floor(durationMs / 1000));
        reject(error);
      }
    } finally {
      this.activeExecutions.delete(job.id);
      this.providerRunningCounts.set(providerName, Math.max(0, (this.providerRunningCounts.get(providerName) || 1) - 1));
      this.processNext(providerName);
    }
  }

  cancelJob(jobId) {
    const active = this.activeExecutions.get(jobId);
    if (active) { active.abortController.abort(); return true; }
    for (const [sessionId, queue] of this.sessionQueues.entries()) {
      const idx = queue.findIndex((item) => item.job.id === jobId);
      if (idx !== -1) {
        const [removed] = queue.splice(idx, 1);
        JobRuntime.markCancelled(jobId);
        if (removed.onStatusUpdate) removed.onStatusUpdate(JobStatus.CANCELLED, 0);
        removed.reject(new Error('작업이 대기 중 취소되었습니다.'));
        if (queue.length === 0) this.sessionQueues.delete(sessionId);
        return true;
      }
    }
    return false;
  }

  cancelActiveJobForSession(sessionId) {
    for (const [jobId, active] of this.activeExecutions.entries()) if (active.sessionId === sessionId) return this.cancelJob(jobId);
    const queue = this.sessionQueues.get(sessionId);
    if (queue && queue.length > 0) return this.cancelJob(queue[0].job.id);
    return false;
  }

  getQueueStats() {
    let totalQueued = 0;
    for (const q of this.sessionQueues.values()) totalQueued += q.length;
    const running = {};
    for (const [p, c] of this.providerRunningCounts.entries()) running[p] = c;
    return { activeExecutionsCount: this.activeExecutions.size, totalQueued, providerRunning: running, providerLimits: Object.fromEntries(this.providerConcurrencyLimits) };
  }
}

export const queueManager = new QueueManager();
