import { PreviewStatus } from './preview-registry.js';
import { previewContainerName } from './preview-runtime.js';
import { PreviewRuntimeType } from './preview-contract.js';

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/;
const TARGET_PATTERN = /^agent-hub-preview-[a-z0-9_.-]+$/;

export class PreviewRouteError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = 'PreviewRouteError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizePreviewHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new PreviewRouteError('INVALID_HOSTNAME', '올바르지 않은 Preview hostname입니다.', 400);
  }
  return hostname;
}

export class PreviewRouteService {
  constructor({ registry } = {}) {
    if (!registry) throw new Error('Preview Registry가 필요합니다.');
    this.registry = registry;
  }

  resolve(hostname) {
    const normalized = normalizePreviewHostname(hostname);
    const preview = this.registry.getByHostname(normalized);
    if (!preview) throw new PreviewRouteError('NOT_FOUND', 'Preview를 찾을 수 없습니다.', 404);
    if (preview.status !== PreviewStatus.RUNNING) {
      throw new PreviewRouteError('UNAVAILABLE', '실행 중인 Preview가 아닙니다.', 409);
    }
    if (preview.runtime_type === PreviewRuntimeType.BACKEND_API && !preview.access_verified) {
      throw new PreviewRouteError('EXTERNAL_ACCESS_BLOCKED', 'Cloudflare Access가 검증되지 않은 API Preview입니다.', 403);
    }
    if (!CONTAINER_ID_PATTERN.test(String(preview.container_id || ''))) {
      throw new PreviewRouteError('INVALID_TARGET', 'Preview target이 준비되지 않았습니다.', 503);
    }
    if (!Number.isInteger(preview.port) || preview.port < 1 || preview.port > 65535) {
      throw new PreviewRouteError('INVALID_TARGET', 'Preview port가 준비되지 않았습니다.', 503);
    }
    const targetHost = previewContainerName(preview.id);
    if (!TARGET_PATTERN.test(targetHost)) {
      throw new PreviewRouteError('INVALID_TARGET', 'Preview target hostname이 올바르지 않습니다.', 503);
    }
    this.registry.touchActivity(preview.id);
    return {
      previewId: preview.id,
      hostname: preview.public_hostname,
      targetHost,
      targetPort: preview.port,
      runtimeType: preview.runtime_type || 'WEB',
      openapiJsonPath: preview.openapi_json_path || null
    };
  }
}
