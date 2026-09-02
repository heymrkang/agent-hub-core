import { PreviewStatus } from './preview-registry.js';
import { PreviewPortDetector } from './port-detector.js';
import { PreviewHttpReadiness } from './http-readiness.js';
import { createPreviewFailureDiagnostic } from './failure-diagnostics.js';
import { redactSecrets } from '../utils/redact.js';
import { OpenApiDiscovery } from './openapi-discovery.js';
import { PreviewRuntimeType } from './preview-contract.js';
import { PreviewSecurityPolicy } from './preview-security-policy.js';

export class PreviewStartError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreviewStartError';
    this.code = code;
  }
}

export class PreviewManager {
  constructor({ registry, runtime, portDetector = null, readiness = null, openapiDiscovery = null, securityPolicy = null, logger = console } = {}) {
    if (!registry || !runtime) throw new Error('Preview Registry와 Runtime이 필요합니다.');
    this.registry = registry;
    this.runtime = runtime;
    this.portDetector = portDetector || new PreviewPortDetector({ runtime });
    this.readiness = readiness || new PreviewHttpReadiness({ runtime });
    this.openapiDiscovery = openapiDiscovery || new OpenApiDiscovery({ runtime });
    this.securityPolicy = securityPolicy || new PreviewSecurityPolicy();
    this.logger = logger;
  }

  async start({ sessionId, detectedRuntime, manualPort = null } = {}) {
    const startedAt = Date.now();
    let stage = 'registry';
    let created = null;
    let securedRuntime = detectedRuntime;
    this.logger.log(`[Preview] 시작 요청: project=${detectedRuntime?.projectName || 'unknown'} package_manager=${detectedRuntime?.packageManager || 'unknown'} manual_port=${manualPort ?? 'auto'}`);
    let preview = this.registry.create({
      sessionId,
      workspacePath: detectedRuntime?.projectPath,
      projectName: detectedRuntime?.projectName,
      runtimeType: detectedRuntime?.runtimeType,
      framework: detectedRuntime?.framework
    });
    try {
      if (detectedRuntime?.runtimeType === PreviewRuntimeType.BACKEND_API) {
        stage = 'data_isolation';
        if (typeof this.securityPolicy.prepareRuntime === 'function') {
          securedRuntime = this.securityPolicy.prepareRuntime(detectedRuntime);
        }
        preview = this.registry.updateContract(preview.id, {
          accessVerified: await this.securityPolicy.verifyExternalAccess(preview.public_url)
        });
      }
      stage = 'container_create';
      created = await this.runtime.create({ preview, runtime: securedRuntime });
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
      stage = 'http_readiness';
      const readiness = await this.readiness.wait(created.id, {
        port,
        path: detectedRuntime.readinessPath || '/'
      });
      this.logger.log(`[Preview] HTTP 준비 완료: project=${preview.project_name || detectedRuntime.projectName} preview=${preview.id} port=${port} path=${readiness.path} status=${readiness.statusCode}`);
      if (detectedRuntime.runtimeType === PreviewRuntimeType.BACKEND_API) {
        preview = await this.#discoverApiEndpoints(preview, detectedRuntime);
      }
      const running = this.registry.updateStatus(preview.id, PreviewStatus.RUNNING);
      this.logger.log(`[Preview] 실행 완료: project=${running.project_name || detectedRuntime.projectName} preview=${running.id} port=${port} duration_ms=${Date.now() - startedAt}`);
      return running;
    } catch (error) {
      let output = '';
      let state = null;
      if (preview.container_id) {
        try {
          output = await this.runtime.logs(preview.container_id, { tail: 80 });
        } catch (logError) {
          this.logger.error(`[Preview] 실패 로그 조회 불가: preview=${preview.id} error=${redactSecrets(logError?.message || logError)}`);
        }
        try {
          state = await this.runtime.inspect(preview.container_id);
        } catch (inspectError) {
          this.logger.error(`[Preview] 실패 상태 조회 불가: preview=${preview.id} error=${redactSecrets(inspectError?.message || inspectError)}`);
        }
      }
      const diagnostic = createPreviewFailureDiagnostic({
        error,
        stage,
        command: detectedRuntime?.command || created?.command,
        state,
        logs: output
      });
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: diagnostic });
      this.logger.error(`[Preview] 시작 실패: project=${preview.project_name || detectedRuntime?.projectName || 'unknown'} preview=${preview.id} container=${preview.container_id || 'none'} stage=${stage} code=${error?.code || 'unknown'} duration_ms=${Date.now() - startedAt}\n${diagnostic}`);
      if (preview.container_id) {
        try {
          await this.runtime.remove(preview.container_id, { force: true });
          this.registry.updateRuntime(preview.id, { containerId: null });
          this.logger.log(`[Preview] 실패 컨테이너 정리 완료: preview=${preview.id} container=${preview.container_id}`);
        } catch (cleanupError) {
          this.logger.error(`[Preview] 실패 컨테이너 정리 불가: preview=${preview.id} container=${preview.container_id} error=${redactSecrets(cleanupError?.message || cleanupError)}`);
        }
      }
      throw new PreviewStartError(error?.code || 'PREVIEW_START_FAILED', diagnostic, error);
    }
  }

  async reconcile(previewId, { verifyHttp = false } = {}) {
    let preview = this.registry.require(previewId);
    if (![PreviewStatus.STARTING, PreviewStatus.RUNNING].includes(preview.status) || !preview.container_id) return preview;
    try {
      const state = await this.runtime.inspect(preview.container_id);
      if (!state.running) {
        return this.registry.updateStatus(preview.id, PreviewStatus.FAILED, {
          failureReason: `dev server가 종료됐습니다. (exit ${state.exitCode ?? 'unknown'})`
        });
      }
      const shouldVerifyHttp = verifyHttp || preview.status === PreviewStatus.STARTING;
      if (shouldVerifyHttp) {
        const port = await this.portDetector.detect(preview.container_id, { manualPort: preview.port });
        await this.readiness.wait(preview.container_id, { port, path: '/' });
        preview = this.registry.updateRuntime(preview.id, { port });
      }
      if (preview.runtime_type === PreviewRuntimeType.BACKEND_API) {
        preview = this.registry.updateContract(preview.id, {
          accessVerified: state.labels?.['agent-hub.data-isolation'] === 'verified'
            && await this.securityPolicy.verifyExternalAccess(preview.public_url)
        });
        if (shouldVerifyHttp) {
          preview = await this.#discoverApiEndpoints(preview, {
            projectPath: preview.workspace_path
          });
        }
      }
      if (preview.status === PreviewStatus.STARTING) {
        preview = this.registry.updateStatus(preview.id, PreviewStatus.RUNNING);
      }
      return preview;
    } catch (error) {
      return this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: redactSecrets(error?.message || error).slice(0, 2000) });
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
      const safeError = redactSecrets(error?.message || error).slice(0, 2000);
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: safeError });
      this.logger.error(`[Preview] 종료 실패: project=${preview.project_name || 'unknown'} preview=${preview.id} error=${safeError}`);
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
      const state = await this.runtime.restart(preview.container_id);
      const port = await this.portDetector.detect(preview.container_id, { manualPort: preview.port });
      await this.readiness.wait(preview.container_id, { port, path: '/' });
      preview = this.registry.updateRuntime(preview.id, { port });
      if (preview.runtime_type === PreviewRuntimeType.BACKEND_API) {
        preview = this.registry.updateContract(preview.id, {
          accessVerified: state.labels?.['agent-hub.data-isolation'] === 'verified'
            && await this.securityPolicy.verifyExternalAccess(preview.public_url)
        });
        preview = await this.#discoverApiEndpoints(preview, {
          projectPath: preview.workspace_path
        });
      }
      const restarted = this.registry.touchActivity(preview.id);
      this.logger.log(`[Preview] 재시작 완료: project=${restarted.project_name || 'unknown'} preview=${restarted.id} port=${port}`);
      return restarted;
    } catch (error) {
      let output = '';
      let state = null;
      try { output = await this.runtime.logs(preview.container_id, { tail: 80 }); } catch {}
      try { state = await this.runtime.inspect(preview.container_id); } catch {}
      const diagnostic = createPreviewFailureDiagnostic({
        error,
        stage: 'restart_http_readiness',
        command: preview.command,
        state,
        logs: output
      });
      this.registry.updateStatus(preview.id, PreviewStatus.FAILED, { failureReason: diagnostic });
      this.logger.error(`[Preview] 재시작 실패: project=${preview.project_name || 'unknown'} preview=${preview.id}\n${diagnostic}`);
      throw new PreviewStartError(error?.code || 'PREVIEW_RESTART_FAILED', diagnostic, error);
    }
  }

  async logs(previewId, { tail = 100 } = {}) {
    const preview = this.registry.require(previewId);
    if (!preview.container_id) throw new Error('Preview container가 없습니다.');
    const output = await this.runtime.logs(preview.container_id, { tail });
    this.registry.touchActivity(preview.id);
    return redactSecrets(output);
  }

  async #discoverApiEndpoints(preview, runtime) {
    try {
      const discovered = await this.openapiDiscovery.discover(preview.container_id, {
        port: preview.port,
        projectPath: runtime.projectPath,
        openapiUiPath: runtime.openapiUiPath,
        openapiJsonPath: runtime.openapiJsonPath,
        healthPath: runtime.healthPath
      });
      const updated = this.registry.updateContract(preview.id, discovered);
      const warning = discovered.warnings.length ? ` warnings=${redactSecrets(discovered.warnings.join(' | '))}` : '';
      this.logger.log(`[Preview] API endpoint 탐지 완료: preview=${preview.id} openapi_ui=${updated.openapi_ui_path || 'none'} openapi_json=${updated.openapi_json_path || 'none'} health=${updated.health_path || 'none'}${warning}`);
      return updated;
    } catch (error) {
      this.logger.error(`[Preview] API endpoint 탐지 건너뜀: preview=${preview.id} error=${redactSecrets(error?.message || error)}`);
      return preview;
    }
  }
}
