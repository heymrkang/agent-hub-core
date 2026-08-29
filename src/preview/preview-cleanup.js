import { Logger } from '../logging/logger.js';
import { ACTIVE_PREVIEW_STATUSES, PreviewStatus } from './preview-registry.js';

function errorText(error) {
  return String(error?.message || error).slice(0, 2000);
}

export class PreviewCleanup {
  constructor({ registry, runtime, manager, idleTimeoutHours = () => 24, logger = Logger } = {}) {
    if (!registry || !runtime || !manager) throw new Error('Preview cleanup dependency가 필요합니다.');
    this.registry = registry;
    this.runtime = runtime;
    this.manager = manager;
    this.idleTimeoutHours = idleTimeoutHours;
    this.logger = logger;
  }

  async startupReconcile() {
    const summary = { stopped: 0, orphansRemoved: 0, failures: 0 };
    for (const preview of this.registry.list({ limit: 500 }).filter((item) => ACTIVE_PREVIEW_STATUSES.includes(item.status))) {
      try {
        await this.#disableAndRemove(preview, PreviewStatus.STOPPED);
        summary.stopped += 1;
      } catch (error) {
        summary.failures += 1;
        this.#logFailure('preview_startup_reconcile_failed', preview, error);
      }
    }
    const orphanSummary = await this.cleanupOrphans();
    summary.orphansRemoved = orphanSummary.removed;
    summary.failures += orphanSummary.failures;
    return summary;
  }

  async sweep({ now = new Date() } = {}) {
    const summary = { expired: 0, crashed: 0, terminalRemoved: 0, orphansRemoved: 0, failures: 0 };
    const timeoutHours = Number(this.idleTimeoutHours());
    if (!Number.isInteger(timeoutHours) || timeoutHours < 0 || timeoutHours > 48) throw new Error('Preview idle timeout 설정이 올바르지 않습니다.');
    const cutoff = now.getTime() - timeoutHours * 60 * 60 * 1000;

    for (const preview of this.registry.list({ limit: 500 })) {
      try {
        if (timeoutHours > 0 && [PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(preview.status)) {
          const activity = Date.parse(`${String(preview.last_activity_at || '').replace(' ', 'T')}Z`);
          if (Number.isFinite(activity) && activity <= cutoff) {
            await this.#disableAndRemove(preview, PreviewStatus.EXPIRED);
            summary.expired += 1;
            continue;
          }
        }
        if ([PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(preview.status)) {
          const reconciled = await this.manager.reconcile(preview.id);
          if (reconciled.status === PreviewStatus.FAILED) {
            summary.crashed += 1;
            await this.#removeContainer(reconciled);
            summary.terminalRemoved += 1;
          }
        }
        if (preview.status === PreviewStatus.STOPPING) {
          await this.#disableAndRemove(preview, PreviewStatus.STOPPED);
          summary.terminalRemoved += 1;
        }
      } catch (error) {
        summary.failures += 1;
        this.#logFailure('preview_cleanup_failed', preview, error);
      }
    }

    const orphanSummary = await this.cleanupOrphans();
    summary.orphansRemoved = orphanSummary.removed;
    summary.failures += orphanSummary.failures;
    return summary;
  }

  async cleanupOrphans() {
    const summary = { removed: 0, failures: 0 };
    const managedIds = await this.runtime.listManaged({ all: true });
    for (const containerId of managedIds) {
      try {
        const container = await this.runtime.inspect(containerId);
        const previewId = container.labels?.['agent-hub.preview-id'];
        const preview = previewId ? this.registry.getById(previewId) : null;
        const isCanonical = preview?.container_id === container.id || preview?.container_id === containerId;
        if (isCanonical && ACTIVE_PREVIEW_STATUSES.includes(preview.status)) continue;
        await this.runtime.remove(containerId, { force: true });
        summary.removed += 1;
      } catch (error) {
        summary.failures += 1;
        this.#logFailure('preview_orphan_cleanup_failed', { id: null, container_id: containerId }, error);
      }
    }
    return summary;
  }

  async #disableAndRemove(preview, finalStatus) {
    let current = this.registry.require(preview.id);
    if (finalStatus === PreviewStatus.EXPIRED) {
      current = this.registry.updateStatus(current.id, PreviewStatus.EXPIRED);
    } else if (ACTIVE_PREVIEW_STATUSES.includes(current.status)) {
      if ([PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(current.status)) current = this.registry.updateStatus(current.id, PreviewStatus.STOPPING);
    }
    await this.#removeContainer(current);
    if (finalStatus === PreviewStatus.STOPPED && this.registry.require(current.id).status !== PreviewStatus.STOPPED) {
      this.registry.updateStatus(current.id, PreviewStatus.STOPPED);
    }
  }

  async #removeContainer(preview) {
    if (!preview.container_id) return;
    try { await this.runtime.stop(preview.container_id, { timeoutSeconds: 10 }); } catch (error) {
      if (error?.code !== 'NOT_FOUND') throw error;
    }
    try { await this.runtime.remove(preview.container_id, { force: true }); } catch (error) {
      if (error?.code !== 'NOT_FOUND') throw error;
    }
  }

  #logFailure(event, preview, error) {
    this.logger.error('system', event, { previewId: preview?.id || null, containerId: preview?.container_id || null, error: errorText(error) }, { errorCode: 'PREVIEW_CLEANUP' });
  }
}
