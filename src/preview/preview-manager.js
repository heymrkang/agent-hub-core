import { PreviewStatus } from './preview-registry.js';
import { PreviewPortDetector } from './port-detector.js';

export class PreviewManager {
  constructor({ registry, runtime, portDetector = null } = {}) {
    if (!registry || !runtime) throw new Error('Preview Registry와 Runtime이 필요합니다.');
    this.registry = registry;
    this.runtime = runtime;
    this.portDetector = portDetector || new PreviewPortDetector({ runtime });
  }

  async start({ sessionId, detectedRuntime, manualPort = null } = {}) {
    let preview = this.registry.create({
      sessionId,
      workspacePath: detectedRuntime?.projectPath,
      projectName: detectedRuntime?.projectName
    });
    try {
      const created = await this.runtime.create({ preview, runtime: detectedRuntime });
      preview = this.registry.updateRuntime(preview.id, {
        containerId: created.id,
        command: JSON.stringify(created.command),
        packageManager: detectedRuntime.packageManager
      });
      await this.runtime.start(created.id);
      const port = await this.portDetector.detect(created.id, { manualPort });
      preview = this.registry.updateRuntime(preview.id, { port });
      return this.registry.updateStatus(preview.id, PreviewStatus.RUNNING);
    } catch (error) {
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: String(error?.message || error).slice(0, 2000) });
      throw error;
    }
  }

  async reconcile(previewId) {
    const preview = this.registry.require(previewId);
    if (![PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(preview.status) || !preview.container_id) return preview;
    try {
      const state = await this.runtime.inspect(preview.container_id);
      if (!state.running) {
        return this.registry.updateStatus(preview.id, PreviewStatus.FAILED, {
          failureReason: `dev server가 종료됐습니다. (exit ${state.exitCode ?? 'unknown'})`
        });
      }
      return preview;
    } catch (error) {
      return this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: String(error?.message || error).slice(0, 2000) });
    }
  }
}
