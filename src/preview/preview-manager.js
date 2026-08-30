import { PreviewStatus } from './preview-registry.js';
import { PreviewPortDetector } from './port-detector.js';

export class PreviewManager {
  constructor({ registry, runtime, portDetector = null, logger = console } = {}) {
    if (!registry || !runtime) throw new Error('Preview Registry와 Runtime이 필요합니다.');
    this.registry = registry;
    this.runtime = runtime;
    this.portDetector = portDetector || new PreviewPortDetector({ runtime });
    this.logger = logger;
  }

  async start({ sessionId, detectedRuntime, manualPort = null } = {}) {
    const startedAt = Date.now();
    let stage = 'registry';
    this.logger.log(`[Preview] 시작 요청: project=${detectedRuntime?.projectName || 'unknown'} package_manager=${detectedRuntime?.packageManager || 'unknown'} manual_port=${manualPort ?? 'auto'}`);
    let preview = this.registry.create({
      sessionId,
      workspacePath: detectedRuntime?.projectPath,
      projectName: detectedRuntime?.projectName
    });
    try {
      stage = 'container_create';
      const created = await this.runtime.create({ preview, runtime: detectedRuntime });
      preview = this.registry.updateRuntime(preview.id, {
        containerId: created.id,
        command: JSON.stringify(created.command),
        packageManager: detectedRuntime.packageManager
      });
      this.logger.log(`[Preview] 컨테이너 생성 완료: project=${preview.project_name || detectedRuntime.projectName} preview=${preview.id} container=${created.id}`);
      stage = 'container_start';
      await this.runtime.start(created.id);
      this.logger.log(`[Preview] 의존성 설치 및 개발 서버 준비 중: project=${preview.project_name || detectedRuntime.projectName} container=${created.id}`);
      stage = 'port_detection';
      const port = await this.portDetector.detect(created.id, { manualPort });
      preview = this.registry.updateRuntime(preview.id, { port });
      const running = this.registry.updateStatus(preview.id, PreviewStatus.RUNNING);
      this.logger.log(`[Preview] 실행 완료: project=${running.project_name || detectedRuntime.projectName} preview=${running.id} port=${port} duration_ms=${Date.now() - startedAt}`);
      return running;
    } catch (error) {
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: String(error?.message || error).slice(0, 2000) });
      this.logger.error(`[Preview] 시작 실패: project=${preview.project_name || detectedRuntime?.projectName || 'unknown'} preview=${preview.id} container=${preview.container_id || 'none'} stage=${stage} code=${error?.code || 'unknown'} duration_ms=${Date.now() - startedAt} error=${String(error?.message || error)}`);
      if (preview.container_id) {
        try {
          const output = String(await this.runtime.logs(preview.container_id, { tail: 80 }) || '')
            .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
            .trim()
            .slice(-8000);
          this.logger.error(`[Preview] 실패 시 컨테이너 로그: project=${preview.project_name || detectedRuntime?.projectName || 'unknown'} preview=${preview.id}\n${output || '(출력 없음)'}`);
        } catch (logError) {
          this.logger.error(`[Preview] 실패 로그 조회 불가: preview=${preview.id} error=${String(logError?.message || logError)}`);
        }
        try {
          await this.runtime.remove(preview.container_id, { force: true });
          this.registry.updateRuntime(preview.id, { containerId: null });
          this.logger.log(`[Preview] 실패 컨테이너 정리 완료: preview=${preview.id} container=${preview.container_id}`);
        } catch (cleanupError) {
          this.logger.error(`[Preview] 실패 컨테이너 정리 불가: preview=${preview.id} container=${preview.container_id} error=${String(cleanupError?.message || cleanupError)}`);
        }
      }
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

  async stop(previewId) {
    let preview = this.registry.require(previewId);
    this.logger.log(`[Preview] 종료 요청: project=${preview.project_name || 'unknown'} preview=${preview.id} container=${preview.container_id || 'none'}`);
    if ([PreviewStatus.STOPPED, PreviewStatus.EXPIRED].includes(preview.status)) return preview;
    if (!preview.container_id) return this.registry.updateStatus(preview.id, PreviewStatus.STOPPED);
    try {
      if ([PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(preview.status)) {
        preview = this.registry.updateStatus(preview.id, PreviewStatus.STOPPING);
      }
      await this.runtime.stop(preview.container_id);
      await this.runtime.remove(preview.container_id);
      const stopped = this.registry.updateStatus(preview.id, PreviewStatus.STOPPED);
      this.logger.log(`[Preview] 종료 완료: project=${stopped.project_name || 'unknown'} preview=${stopped.id}`);
      return stopped;
    } catch (error) {
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: String(error?.message || error).slice(0, 2000) });
      this.logger.error(`[Preview] 종료 실패: project=${preview.project_name || 'unknown'} preview=${preview.id} error=${String(error?.message || error)}`);
      throw error;
    }
  }

  async restart(previewId) {
    let preview = this.registry.require(previewId);
    if (preview.status !== PreviewStatus.RUNNING || !preview.container_id) {
      throw new Error('RUNNING Preview만 재시작할 수 있습니다. 정지된 Preview는 다시 start 하세요.');
    }
    this.logger.log(`[Preview] 재시작 요청: project=${preview.project_name || 'unknown'} preview=${preview.id} container=${preview.container_id}`);
    try {
      await this.runtime.restart(preview.container_id);
      const port = await this.portDetector.detect(preview.container_id, { manualPort: preview.port });
      preview = this.registry.updateRuntime(preview.id, { port });
      const restarted = this.registry.touchActivity(preview.id);
      this.logger.log(`[Preview] 재시작 완료: project=${restarted.project_name || 'unknown'} preview=${restarted.id} port=${port}`);
      return restarted;
    } catch (error) {
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: String(error?.message || error).slice(0, 2000) });
      this.logger.error(`[Preview] 재시작 실패: project=${preview.project_name || 'unknown'} preview=${preview.id} error=${String(error?.message || error)}`);
      throw error;
    }
  }

  async logs(previewId, { tail = 100 } = {}) {
    const preview = this.registry.require(previewId);
    if (!preview.container_id) throw new Error('Preview container가 없습니다.');
    const output = await this.runtime.logs(preview.container_id, { tail });
    this.registry.touchActivity(preview.id);
    return output;
  }
}
