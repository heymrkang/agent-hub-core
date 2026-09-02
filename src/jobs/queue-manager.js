import { JobRuntime } from './job-runtime.js';
import { JobStatus, ErrorCategory } from './types.js';
import { providerManager } from '../providers/provider-manager.js';
import { ContextManager } from '../context/context-manager.js';
import { ProviderSessionRepository } from '../sessions/provider-session-repository.js';
import { getSettingsManager } from '../settings/settings-manager.js';
import { Compactor } from '../context/compactor.js';
import { modelCatalog } from '../providers/model-catalog.js';
import { runtimeConfig } from '../config/runtime-config.js';

class QueueManager {
  constructor() {
    this.sessionQueues = new Map();
    this.providerRunningCounts = new Map();
    this.providerConcurrencyLimits = new Map([
      ['codex', runtimeConfig.codexConcurrency],
      ['antigravity', runtimeConfig.antigravityConcurrency]
    ]);
    this.activeExecutions = new Map();
  }

  getConcurrencyLimit(providerName) {
    try {
      const settings = getSettingsManager();
      if (settings.has('concurrency_limit')) return settings.get('concurrency_limit');
    } catch {
      // Settings are unavailable during early startup and isolated tests.
    }
    return this.providerConcurrencyLimits.get(providerName.toLowerCase());
  }

  enqueueJob({ sessionId, sessionTitle, provider, model, reasoningEffort = 'default', prompt, profile, onStatusUpdate, type = 'CHAT', timeoutMs = null, queueGraceMs = null }) {
    if (Compactor.isCompactingSession(sessionId)) {
      const error = new Error('현재 세션의 컨텍스트를 압축 중입니다. 완료 후 다시 시도하세요.');
      error.code = 'COMPACT_BUSY';
      throw error;
    }
    modelCatalog.validateReasoningEffort(provider, model, reasoningEffort);
    const jobRecord = JobRuntime.createJob({ sessionId, type, provider, model });
    const abortController = new AbortController();
    const queueItem = {
      job: { ...jobRecord, sessionTitle, reasoningEffort }, prompt, profile, abortController, onStatusUpdate,
      timeoutMs, queueGraceMs, queueTimer: null, resolve: null, reject: null, started: false
    };
    const promise = new Promise((resolve, reject) => { queueItem.resolve = resolve; queueItem.reject = reject; });
    promise.jobId = jobRecord.id;
    if (!this.sessionQueues.has(sessionId)) this.sessionQueues.set(sessionId, []);
    this.sessionQueues.get(sessionId).push(queueItem);
    onStatusUpdate?.(JobStatus.QUEUED, 0);
    if (queueGraceMs && queueGraceMs > 0) queueItem.queueTimer = setTimeout(() => this.expireQueuedItem(queueItem), queueGraceMs);
    this.processNext(provider);
    return promise;
  }

  expireQueuedItem(item) {
    if (item.started) return;
    for (const [sessionId, queue] of this.sessionQueues.entries()) {
      const idx = queue.indexOf(item);
      if (idx === -1) continue;
      queue.splice(idx, 1);
      if (!queue.length) this.sessionQueues.delete(sessionId);
      JobRuntime.markCancelled(item.job.id);
      const error = new Error('Provider queue grace 초과');
      error.code = 'QUEUE_GRACE_EXCEEDED';
      item.reject(error);
      return;
    }
  }

  processNext(providerName = 'codex') {
    const pName = providerName.toLowerCase();
    const limit = this.getConcurrencyLimit(pName);
    while ((this.providerRunningCounts.get(pName) || 0) < limit) {
      let candidate = null;
      for (const [sessionId, queue] of this.sessionQueues.entries()) {
        if (!queue.length || queue[0].job.provider.toLowerCase() !== pName) continue;
        if (Array.from(this.activeExecutions.values()).some((e) => e.sessionId === sessionId)) continue;
        candidate = queue.shift();
        if (!queue.length) this.sessionQueues.delete(sessionId);
        break;
      }
      if (!candidate) break;
      candidate.started = true;
      if (candidate.queueTimer) clearTimeout(candidate.queueTimer);
      this.executeJobItem(candidate);
    }
  }

  async executeJobItem(item) {
    const { job, prompt, profile, abortController, onStatusUpdate, timeoutMs, resolve, reject } = item;
    const providerName = job.provider.toLowerCase();
    this.providerRunningCounts.set(providerName, (this.providerRunningCounts.get(providerName) || 0) + 1);
    const startTime = Date.now();
    JobRuntime.markRunning(job.id);
    const intervalTimer = setInterval(() => onStatusUpdate?.(JobStatus.RUNNING, Math.floor((Date.now() - startTime) / 1000)), 1000);
    const timeoutTimer = timeoutMs && timeoutMs > 0 ? setTimeout(() => abortController.abort(new Error('작업 타임아웃')), timeoutMs) : null;
    onStatusUpdate?.(JobStatus.RUNNING, 0);
    this.activeExecutions.set(job.id, { sessionId: job.session_id, provider: providerName, abortController, intervalTimer, timeoutTimer, startTime });
    try {
      const adapter = providerManager.getAdapter(job.provider);
      const providerSession = ContextManager.getProviderSession(job.session_id, providerName);
      const result = await adapter.executePrompt({ prompt, model: job.model, reasoningEffort: job.reasoningEffort, sessionId: job.session_id, nativeSessionRef: providerSession?.native_session_ref || null, profile, signal: abortController.signal });

      // Native identity is persisted as soon as the Provider turn succeeds. The sync cursor is intentionally
      // NOT advanced here: the assistant canonical message is stored by the caller after this promise resolves.
      // Advancing to the pre-response user message would make cross-provider delta handoff one message stale.
      ContextManager.upsertProviderSession({
        sessionId: job.session_id,
        provider: providerName,
        nativeSessionRef: result.nativeSessionRef || null,
        lastSyncedMessageId: null
      });

      const durationMs = Date.now() - startTime;
      JobRuntime.markCompleted(job.id, durationMs);
      onStatusUpdate?.(JobStatus.COMPLETED, Math.floor(durationMs / 1000));
      resolve(result.response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      if (error?.code === 'CODEX_NATIVE_RESUME_FAILED' || error?.code === 'CODEX_NATIVE_THREAD_MISMATCH') {
        try { ProviderSessionRepository.markFailure({ sessionId: job.session_id, provider: providerName, state: 'ERROR', error }); } catch {}
      }
      if (abortController.signal.aborted) {
        const timedOut = timeoutMs && durationMs >= timeoutMs - 50;
        if (timedOut) { JobRuntime.markFailed(job.id, ErrorCategory.TIMEOUT, '작업 타임아웃', 1, durationMs); onStatusUpdate?.(JobStatus.FAILED, Math.floor(durationMs / 1000)); reject(new Error('작업 타임아웃')); }
        else { JobRuntime.markCancelled(job.id, durationMs); onStatusUpdate?.(JobStatus.CANCELLED, Math.floor(durationMs / 1000)); reject(new Error('작업이 취소되었습니다.')); }
      } else {
        const category = error.message.includes('타임아웃') ? ErrorCategory.TIMEOUT : ErrorCategory.PROVIDER_EXEC;
        JobRuntime.markFailed(job.id, category, error.message, 1, durationMs);
        onStatusUpdate?.(JobStatus.FAILED, Math.floor(durationMs / 1000));
        reject(error);
      }
    } finally {
      clearInterval(intervalTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
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
        if (removed.queueTimer) clearTimeout(removed.queueTimer);
        JobRuntime.markCancelled(jobId);
        removed.onStatusUpdate?.(JobStatus.CANCELLED, 0);
        removed.reject(new Error('작업이 대기 중 취소되었습니다.'));
        if (!queue.length) this.sessionQueues.delete(sessionId);
        return true;
      }
    }
    return false;
  }

  cancelActiveJobForSession(sessionId) {
    for (const [jobId, active] of this.activeExecutions.entries()) if (active.sessionId === sessionId) return this.cancelJob(jobId);
    const queue = this.sessionQueues.get(sessionId);
    return queue?.length ? this.cancelJob(queue[0].job.id) : false;
  }

  hasActiveSession(sessionId) { return Array.from(this.activeExecutions.values()).some((e) => e.sessionId === sessionId); }
  getQueueStats() {
    let totalQueued = 0;
    for (const q of this.sessionQueues.values()) totalQueued += q.length;
    const configuredLimit = (() => { try { const settings = getSettingsManager(); return settings.has('concurrency_limit') ? settings.get('concurrency_limit') : null; } catch { return null; } })();
    return {
      activeExecutionsCount: this.activeExecutions.size,
      totalQueued,
      providerRunning: Object.fromEntries(this.providerRunningCounts),
      providerLimits: Object.fromEntries(['codex', 'antigravity'].map((p) => [p, configuredLimit ?? this.providerConcurrencyLimits.get(p)]))
    };
  }
}
export const queueManager = new QueueManager();
