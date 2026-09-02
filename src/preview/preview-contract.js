export const PreviewRuntimeType = Object.freeze({
  WEB: 'WEB',
  BACKEND_API: 'BACKEND_API'
});

export const PreviewFramework = Object.freeze({
  NEXTJS: 'NEXTJS',
  VITE: 'VITE',
  NESTJS: 'NESTJS'
});

export const PreviewCapability = Object.freeze({
  HTTP: 'HTTP',
  OPENAPI: 'OPENAPI',
  HEALTH: 'HEALTH'
});

const FRAMEWORK_RUNTIME = Object.freeze({
  [PreviewFramework.NEXTJS]: PreviewRuntimeType.WEB,
  [PreviewFramework.VITE]: PreviewRuntimeType.WEB,
  [PreviewFramework.NESTJS]: PreviewRuntimeType.BACKEND_API
});

export class PreviewContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreviewContractError';
    this.code = code;
  }
}

export function normalizePreviewRuntimeType(value = PreviewRuntimeType.WEB) {
  const runtimeType = String(value || '').trim().toUpperCase();
  if (!Object.hasOwn(PreviewRuntimeType, runtimeType)) {
    throw new PreviewContractError('INVALID_RUNTIME_TYPE', `올바르지 않은 Preview runtime type: ${value}`);
  }
  return runtimeType;
}

export function normalizePreviewFramework(value, runtimeType) {
  if (value === undefined || value === null || value === '') return null;
  const framework = String(value).trim().toUpperCase();
  if (!Object.hasOwn(PreviewFramework, framework)) {
    throw new PreviewContractError('INVALID_FRAMEWORK', `지원하지 않는 Preview framework: ${value}`);
  }
  if (FRAMEWORK_RUNTIME[framework] !== runtimeType) {
    throw new PreviewContractError('FRAMEWORK_RUNTIME_MISMATCH', `${framework}는 ${runtimeType} runtime으로 저장할 수 없습니다.`);
  }
  return framework;
}

export function normalizePreviewPath(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (
    normalized.length > 512
    || !normalized.startsWith('/')
    || normalized.startsWith('//')
    || /[\s?#]/.test(normalized)
  ) {
    throw new PreviewContractError('INVALID_ENDPOINT_PATH', `${fieldName}는 query/hash 없는 절대 URL path여야 합니다: ${value}`);
  }
  return normalized;
}

export function normalizeAccessVerified(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new PreviewContractError('INVALID_ACCESS_VERIFIED', 'accessVerified는 boolean이어야 합니다.');
  }
  return value;
}

export function normalizePreviewContract({
  runtimeType = PreviewRuntimeType.WEB,
  framework = null,
  openapiUiPath = null,
  openapiJsonPath = null,
  healthPath = null,
  accessVerified = false
} = {}) {
  const normalizedRuntimeType = normalizePreviewRuntimeType(runtimeType);
  const contract = {
    runtimeType: normalizedRuntimeType,
    framework: normalizePreviewFramework(framework, normalizedRuntimeType),
    openapiUiPath: normalizePreviewPath(openapiUiPath, 'openapiUiPath'),
    openapiJsonPath: normalizePreviewPath(openapiJsonPath, 'openapiJsonPath'),
    healthPath: normalizePreviewPath(healthPath, 'healthPath'),
    accessVerified: normalizeAccessVerified(accessVerified)
  };

  if (
    normalizedRuntimeType !== PreviewRuntimeType.BACKEND_API
    && (contract.openapiUiPath || contract.openapiJsonPath || contract.healthPath)
  ) {
    throw new PreviewContractError('ENDPOINT_RUNTIME_MISMATCH', 'API endpoint metadata는 BACKEND_API runtime에만 저장할 수 있습니다.');
  }
  return Object.freeze(contract);
}

export function getPreviewCapabilities(preview) {
  const capabilities = [PreviewCapability.HTTP];
  if (preview?.openapi_ui_path || preview?.openapi_json_path) capabilities.push(PreviewCapability.OPENAPI);
  if (preview?.health_path) capabilities.push(PreviewCapability.HEALTH);
  return Object.freeze(capabilities);
}
