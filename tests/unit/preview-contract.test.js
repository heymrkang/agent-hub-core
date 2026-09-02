import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviewCapabilities,
  normalizePreviewContract,
  PreviewCapability,
  PreviewContractError,
  PreviewFramework,
  PreviewRuntimeType
} from '../../src/preview/preview-contract.js';

test('Preview runtime, framework, capability 상수를 고정한다', () => {
  assert.deepEqual(Object.values(PreviewRuntimeType), ['WEB', 'BACKEND_API']);
  assert.deepEqual(Object.values(PreviewFramework), ['NEXTJS', 'VITE', 'NESTJS']);
  assert.deepEqual(Object.values(PreviewCapability), ['HTTP', 'OPENAPI', 'HEALTH']);
});

test('기존 Preview 기본 계약은 WEB과 HTTP capability다', () => {
  const contract = normalizePreviewContract();
  assert.deepEqual(contract, {
    runtimeType: 'WEB',
    framework: null,
    openapiUiPath: null,
    openapiJsonPath: null,
    healthPath: null,
    accessVerified: false
  });
  assert.deepEqual(getPreviewCapabilities({}), ['HTTP']);
});

test('BACKEND_API endpoint metadata에서 capability를 파생한다', () => {
  const contract = normalizePreviewContract({
    runtimeType: 'BACKEND_API',
    framework: 'NESTJS',
    openapiUiPath: '/docs',
    openapiJsonPath: '/docs-json',
    healthPath: '/health',
    accessVerified: true
  });
  assert.deepEqual(getPreviewCapabilities({
    openapi_ui_path: contract.openapiUiPath,
    openapi_json_path: contract.openapiJsonPath,
    health_path: contract.healthPath
  }), ['HTTP', 'OPENAPI', 'HEALTH']);
});

test('runtime/framework 불일치와 위험한 endpoint path를 거부한다', () => {
  assert.throws(
    () => normalizePreviewContract({ runtimeType: 'WEB', framework: 'NESTJS' }),
    (error) => error instanceof PreviewContractError && error.code === 'FRAMEWORK_RUNTIME_MISMATCH'
  );
  assert.throws(
    () => normalizePreviewContract({ runtimeType: 'BACKEND_API', healthPath: '//evil.example/health' }),
    (error) => error.code === 'INVALID_ENDPOINT_PATH'
  );
  assert.throws(
    () => normalizePreviewContract({ runtimeType: 'WEB', healthPath: '/health' }),
    (error) => error.code === 'ENDPOINT_RUNTIME_MISMATCH'
  );
});
