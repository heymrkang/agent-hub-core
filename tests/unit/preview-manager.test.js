import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewManager } from '../../src/preview/preview-manager.js';

function registryFake() {
  let preview = { id: 'preview-1', session_id: 'session-1', workspace_path: '/home/dev/app', public_url: 'https://preview-app.12190529.xyz', status: 'STARTING', container_id: null, port: null, runtime_type: null };
  return {
    create: (values = {}) => (preview = { ...preview, runtime_type: values.runtimeType ?? preview.runtime_type, public_url: 'https://preview-app.12190529.xyz', access_verified: values.accessVerified ?? false }),
    updateRuntime: (_id, values) => (preview = { ...preview, container_id: values.containerId === undefined ? preview.container_id : values.containerId, port: values.port ?? preview.port }),
    updateContract: (_id, values) => (preview = {
      ...preview,
      openapi_ui_path: values.openapiUiPath === undefined ? preview.openapi_ui_path : values.openapiUiPath,
      openapi_json_path: values.openapiJsonPath === undefined ? preview.openapi_json_path : values.openapiJsonPath,
      health_path: values.healthPath === undefined ? preview.health_path : values.healthPath,
      access_verified: values.accessVerified === undefined ? preview.access_verified : values.accessVerified
    }),
    updateStatus: (_id, status, options = {}) => (preview = { ...preview, status, failure_reason: options.failureReason ?? null }),
    require: () => preview,
    touchActivity: () => (preview = { ...preview, touched: true }),
    value: () => preview
  };
}

const detectedRuntime = { projectPath: '/home/dev/app', projectName: 'app', packageManager: 'npm', command: { executable: 'npm', args: ['run', 'dev'] } };

test('HTTP readiness 확인 전에는 RUNNING으로 전환하지 않는다', async () => {
  const registry = registryFake();
  let statusDuringDetection;
  let statusDuringReadiness;
  const runtime = {
    create: async () => ({ id: 'container-1', command: ['npm', 'run', 'dev'] }),
    start: async () => ({ running: true })
  };
  const manager = new PreviewManager({
    registry,
    runtime,
    portDetector: { detect: async () => { statusDuringDetection = registry.value().status; return 3001; } },
    readiness: { wait: async (_id, options) => { statusDuringReadiness = registry.value().status; return { ...options, statusCode: 404 }; } }
  });
  const preview = await manager.start({ sessionId: 'session-1', detectedRuntime });
  assert.equal(statusDuringDetection, 'STARTING');
  assert.equal(statusDuringReadiness, 'STARTING');
  assert.equal(preview.status, 'RUNNING');
  assert.equal(preview.port, 3001);
});

test('WEB 런타임도 securityPolicy.prepareRuntime을 거쳐 격리 및 환경변수를 주입받는다', async () => {
  const registry = registryFake();
  let runtimePassedToCreate = null;
  const manager = new PreviewManager({
    registry,
    runtime: {
      create: async ({ runtime }) => {
        runtimePassedToCreate = runtime;
        return { id: 'container-1', command: [] };
      },
      start: async () => ({ running: true })
    },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ path: '/', statusCode: 200 }) },
    securityPolicy: {
      prepareRuntime: (rt) => ({ ...rt, previewEnvironment: { NEXT_PUBLIC_TEST: 'true' }, maskEnvironmentFiles: true }),
      verifyExternalAccess: async () => false
    }
  });
  const preview = await manager.start({
    sessionId: 'session-1',
    detectedRuntime: { ...detectedRuntime, runtimeType: 'WEB', framework: 'NEXTJS' }
  });
  assert.equal(preview.status, 'RUNNING');
  assert.equal(runtimePassedToCreate?.previewEnvironment?.NEXT_PUBLIC_TEST, 'true');
  assert.equal(runtimePassedToCreate?.maskEnvironmentFiles, true);
});

test('BACKEND_API는 readiness 뒤 endpoint를 탐지하고 나서 RUNNING이 된다', async () => {
  const registry = registryFake();
  const states = [];
  const manager = new PreviewManager({
    registry,
    runtime: {
      create: async () => ({ id: 'container-1', command: [] }),
      start: async () => ({ running: true })
    },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ path: '/', statusCode: 404 }) },
    openapiDiscovery: { discover: async () => {
      states.push(registry.value().status);
      return { openapiUiPath: '/docs', openapiJsonPath: '/docs-json', healthPath: '/health', warnings: [] };
    } }
  });
  const preview = await manager.start({
    sessionId: 'session-1',
    detectedRuntime: { ...detectedRuntime, runtimeType: 'BACKEND_API', framework: 'NESTJS' }
  });
  assert.deepEqual(states, ['STARTING']);
  assert.equal(preview.status, 'RUNNING');
  assert.equal(preview.openapi_ui_path, '/docs');
  assert.equal(preview.openapi_json_path, '/docs-json');
  assert.equal(preview.health_path, '/health');
});

test('BACKEND_API 시작은 생성 URL의 Cloudflare Access challenge를 검증한다', async () => {
  const registry = registryFake();
  const manager = new PreviewManager({
    registry,
    runtime: {
      create: async () => ({ id: 'container-1', command: [] }),
      start: async () => ({ running: true })
    },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ path: '/', statusCode: 200 }) },
    openapiDiscovery: { discover: async () => ({ openapiUiPath: null, openapiJsonPath: null, healthPath: '/health', warnings: [] }) },
    securityPolicy: {
      verifyExternalAccess: async (url) => url === 'https://preview-app.12190529.xyz'
    }
  });
  const result = await manager.start({
    sessionId: 'session-1',
    detectedRuntime: { ...detectedRuntime, runtimeType: 'BACKEND_API', framework: 'NESTJS' }
  });
  assert.equal(result.access_verified, true);
});

test('OpenAPI 탐지 예외는 BACKEND_API Preview 시작을 막지 않는다', async () => {
  const registry = registryFake();
  const errors = [];
  const manager = new PreviewManager({
    registry,
    runtime: { create: async () => ({ id: 'container-1', command: [] }), start: async () => ({ running: true }) },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ path: '/', statusCode: 200 }) },
    openapiDiscovery: { discover: async () => { throw new Error('discovery unavailable'); } },
    logger: { log: () => {}, error: (message) => errors.push(message) }
  });
  const preview = await manager.start({
    sessionId: 'session-1',
    detectedRuntime: { ...detectedRuntime, runtimeType: 'BACKEND_API', framework: 'NESTJS' }
  });
  assert.equal(preview.status, 'RUNNING');
  assert.match(errors[0], /탐지 건너뜀/);
});

test('stop은 container를 정지·제거하고 STOPPED로 전환한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  registry.updateStatus('preview-1', 'RUNNING');
  const calls = [];
  const manager = new PreviewManager({ registry, runtime: {
    stop: async (id) => calls.push(['stop', id]),
    remove: async (id) => calls.push(['remove', id])
  }, portDetector: {} });
  const preview = await manager.stop('preview-1');
  assert.deepEqual(calls, [['stop', 'container-1'], ['remove', 'container-1']]);
  assert.equal(preview.status, 'STOPPED');
});

test('restart는 port를 재검증하고 activity를 갱신한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1', port: 3000 });
  registry.updateStatus('preview-1', 'RUNNING');
  let manualPort;
  const manager = new PreviewManager({ registry,
    runtime: { restart: async () => ({ running: true, labels: { 'agent-hub.data-isolation': 'verified' } }) },
    portDetector: { detect: async (_id, options) => { manualPort = options.manualPort; return 3000; } },
    readiness: { wait: async () => ({ statusCode: 200 }) }
  });
  const preview = await manager.restart('preview-1');
  assert.equal(manualPort, 3000);
  assert.equal(preview.touched, true);
});

test('BACKEND_API restart는 이전 endpoint 결과를 override로 재사용하지 않고 다시 탐지한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1', port: 3000 });
  registry.updateContract('preview-1', { openapiUiPath: '/old-docs', openapiJsonPath: '/old-json', healthPath: '/old-health' });
  registry.updateStatus('preview-1', 'RUNNING');
  registry.value().runtime_type = 'BACKEND_API';
  let options;
  const verifiedUrls = [];
  const manager = new PreviewManager({
    registry,
    runtime: { restart: async () => ({ running: true, labels: { 'agent-hub.data-isolation': 'verified' } }) },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ statusCode: 200 }) },
    securityPolicy: { verifyExternalAccess: async (url) => { verifiedUrls.push(url); return true; } },
    openapiDiscovery: { discover: async (_id, received) => {
      options = received;
      return { openapiUiPath: '/new-docs', openapiJsonPath: '/new-json', healthPath: '/health', warnings: [] };
    } }
  });
  const preview = await manager.restart('preview-1');
  assert.deepEqual(options, { port: 3000, projectPath: '/home/dev/app', openapiUiPath: undefined, openapiJsonPath: undefined, healthPath: undefined });
  assert.equal(preview.openapi_ui_path, '/new-docs');
  assert.equal(preview.access_verified, true);
  assert.deepEqual(verifiedUrls, ['https://preview-app.12190529.xyz']);
});

test('logs는 tail을 제한해 조회하고 activity를 갱신한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  let requested;
  const manager = new PreviewManager({ registry, runtime: { logs: async (_id, options) => { requested = options.tail; return 'ready token=private-value'; } }, portDetector: {} });
  assert.equal(await manager.logs('preview-1', { tail: 50 }), 'ready token=[REDACTED]');
  assert.equal(requested, 50);
  assert.equal(registry.value().touched, true);
});

test('start 또는 port 감지 실패를 FAILED로 기록한다', async () => {
  const registry = registryFake();
  const messages = [];
  const removed = [];
  const runtime = { create: async () => ({ id: 'container-1', command: [] }), start: async () => ({ running: true }), logs: async () => '\u001b[31mpnpm confirmation prompt\u001b[0m\npassword=do-not-show', inspect: async () => ({ running: true, exitCode: 0 }), remove: async (id, options) => removed.push([id, options]) };
  const manager = new PreviewManager({ registry, runtime, portDetector: { detect: async () => { throw new Error('port timeout'); } }, logger: { log: () => {}, error: (message) => messages.push(message) } });
  await assert.rejects(() => manager.start({ sessionId: 'session-1', detectedRuntime }), /port timeout/);
  assert.equal(registry.value().status, 'FAILED');
  assert.match(registry.value().failure_reason, /port timeout/);
  assert.match(messages[0], /stage=port_detection/);
  assert.match(messages[0], /pnpm confirmation prompt/);
  assert.doesNotMatch(messages[0], /do-not-show/);
  assert.match(registry.value().failure_reason, /명령:/);
  assert.match(registry.value().failure_reason, /조치:/);
  assert.deepEqual(removed, [['container-1', { force: true }]]);
  assert.equal(registry.value().container_id, null);
});

test('HTTP readiness 실패는 FAILED 처리하고 route 대상 container를 제거한다', async () => {
  const registry = registryFake();
  const runtime = {
    create: async () => ({ id: 'container-1', command: [] }),
    start: async () => ({ running: true }),
    logs: async () => 'Nest application started',
    inspect: async () => ({ running: true, exitCode: 0 }),
    remove: async () => {}
  };
  const manager = new PreviewManager({
    registry,
    runtime,
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => { const error = new Error('0.0.0.0 bind 필요'); error.code = 'HTTP_READINESS_TIMEOUT'; throw error; } },
    logger: { log: () => {}, error: () => {} }
  });
  await assert.rejects(() => manager.start({ sessionId: 'session-1', detectedRuntime }), (error) => {
    assert.equal(error.code, 'HTTP_READINESS_TIMEOUT');
    assert.match(error.message, /단계: http_readiness/);
    return true;
  });
  assert.equal(registry.value().status, 'FAILED');
  assert.equal(registry.value().container_id, null);
});

test('종료된 dev server를 reconcile하면 FAILED 처리한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  registry.updateStatus('preview-1', 'RUNNING');
  const manager = new PreviewManager({ registry, runtime: { inspect: async () => ({ running: false, exitCode: 137 }) }, portDetector: {} });
  const preview = await manager.reconcile('preview-1', { verifyHttp: true });
  assert.equal(preview.status, 'FAILED');
  assert.match(preview.failure_reason, /137/);
});

test('Core 재시작 중 남은 STARTING Preview는 HTTP와 endpoint를 재검증해 RUNNING으로 복구한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1', port: null });
  registry.value().runtime_type = 'BACKEND_API';
  const calls = [];
  const manager = new PreviewManager({
    registry,
    runtime: { inspect: async () => ({ running: true, labels: { 'agent-hub.data-isolation': 'verified' } }) },
    portDetector: { detect: async (_id, options) => { calls.push(['port', options.manualPort]); return 3100; } },
    readiness: { wait: async (_id, options) => { calls.push(['readiness', options]); return { statusCode: 404 }; } },
    securityPolicy: { verifyExternalAccess: async () => true },
    openapiDiscovery: { discover: async () => ({ openapiUiPath: '/docs', openapiJsonPath: '/docs-json', healthPath: '/health', warnings: [] }) }
  });
  const preview = await manager.reconcile('preview-1');
  assert.equal(preview.status, 'RUNNING');
  assert.equal(preview.port, 3100);
  assert.equal(preview.openapi_json_path, '/docs-json');
  assert.equal(preview.access_verified, true);
  assert.deepEqual(calls, [
    ['port', null],
    ['readiness', { port: 3100, path: '/' }]
  ]);
});

test('실행 중이어도 Core 재시작 HTTP 재검증 실패 시 FAILED 처리한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1', port: 3000 });
  registry.updateStatus('preview-1', 'RUNNING');
  const manager = new PreviewManager({
    registry,
    runtime: { inspect: async () => ({ running: true, labels: {} }) },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => { throw new Error('HTTP recovery timeout'); } }
  });
  const preview = await manager.reconcile('preview-1', { verifyHttp: true });
  assert.equal(preview.status, 'FAILED');
  assert.match(preview.failure_reason, /HTTP recovery timeout/);
});

test('정기 reconcile은 생존 상태만 확인하고 순간 HTTP 지연으로 Preview를 종료하지 않는다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1', port: 3000 });
  registry.updateStatus('preview-1', 'RUNNING');
  let httpProbeCalled = false;
  const manager = new PreviewManager({
    registry,
    runtime: { inspect: async () => ({ running: true, labels: {} }) },
    portDetector: { detect: async () => { httpProbeCalled = true; throw new Error('transient'); } },
    readiness: { wait: async () => { httpProbeCalled = true; throw new Error('transient'); } }
  });
  const preview = await manager.reconcile('preview-1');
  assert.equal(preview.status, 'RUNNING');
  assert.equal(httpProbeCalled, false);
});

test('실행 중인 BACKEND_API reconcile은 Access 상태를 다시 검증해 차단 상태를 갱신한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  registry.updateStatus('preview-1', 'RUNNING');
  registry.value().runtime_type = 'BACKEND_API';
  registry.updateContract('preview-1', { accessVerified: true });
  const manager = new PreviewManager({
    registry,
    runtime: { inspect: async () => ({ running: true, exitCode: 0, labels: { 'agent-hub.data-isolation': 'verified' } }) },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ statusCode: 200 }) },
    openapiDiscovery: { discover: async () => ({ openapiUiPath: null, openapiJsonPath: null, healthPath: '/health', warnings: [] }) },
    securityPolicy: { verifyExternalAccess: async () => false }
  });
  const preview = await manager.reconcile('preview-1');
  assert.equal(preview.status, 'RUNNING');
  assert.equal(preview.access_verified, false);
});

test('격리 label 없는 기존 BACKEND_API container는 Access가 정상이어도 외부 route를 닫는다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  registry.updateStatus('preview-1', 'RUNNING');
  registry.value().runtime_type = 'BACKEND_API';
  registry.updateContract('preview-1', { accessVerified: true });
  let accessProbeCalled = false;
  const manager = new PreviewManager({
    registry,
    runtime: { inspect: async () => ({ running: true, exitCode: 0, labels: {} }) },
    portDetector: { detect: async () => 3000 },
    readiness: { wait: async () => ({ statusCode: 200 }) },
    openapiDiscovery: { discover: async () => ({ openapiUiPath: null, openapiJsonPath: null, healthPath: '/health', warnings: [] }) },
    securityPolicy: { verifyExternalAccess: async () => { accessProbeCalled = true; return true; } }
  });
  const preview = await manager.reconcile('preview-1');
  assert.equal(preview.access_verified, false);
  assert.equal(accessProbeCalled, false);
});
