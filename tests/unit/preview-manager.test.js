import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewManager } from '../../src/preview/preview-manager.js';

function registryFake() {
  let preview = { id: 'preview-1', session_id: 'session-1', status: 'STARTING', container_id: null, port: null };
  return {
    create: () => preview,
    updateRuntime: (_id, values) => (preview = { ...preview, container_id: values.containerId ?? preview.container_id, port: values.port ?? preview.port }),
    updateStatus: (_id, status, options = {}) => (preview = { ...preview, status, failure_reason: options.failureReason ?? null }),
    require: () => preview,
    touchActivity: () => (preview = { ...preview, touched: true }),
    value: () => preview
  };
}

const detectedRuntime = { projectPath: '/home/dev/app', projectName: 'app', packageManager: 'npm', command: { executable: 'npm', args: ['run', 'dev'] } };

test('port 확인 전에는 RUNNING으로 전환하지 않는다', async () => {
  const registry = registryFake();
  let statusDuringDetection;
  const runtime = {
    create: async () => ({ id: 'container-1', command: ['npm', 'run', 'dev'] }),
    start: async () => ({ running: true })
  };
  const manager = new PreviewManager({ registry, runtime, portDetector: { detect: async () => { statusDuringDetection = registry.value().status; return 3001; } } });
  const preview = await manager.start({ sessionId: 'session-1', detectedRuntime });
  assert.equal(statusDuringDetection, 'STARTING');
  assert.equal(preview.status, 'RUNNING');
  assert.equal(preview.port, 3001);
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
    runtime: { restart: async () => ({ running: true }) },
    portDetector: { detect: async (_id, options) => { manualPort = options.manualPort; return 3000; } }
  });
  const preview = await manager.restart('preview-1');
  assert.equal(manualPort, 3000);
  assert.equal(preview.touched, true);
});

test('logs는 tail을 제한해 조회하고 activity를 갱신한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  let requested;
  const manager = new PreviewManager({ registry, runtime: { logs: async (_id, options) => { requested = options.tail; return 'ready'; } }, portDetector: {} });
  assert.equal(await manager.logs('preview-1', { tail: 50 }), 'ready');
  assert.equal(requested, 50);
  assert.equal(registry.value().touched, true);
});

test('start 또는 port 감지 실패를 FAILED로 기록한다', async () => {
  const registry = registryFake();
  const runtime = { create: async () => ({ id: 'container-1', command: [] }), start: async () => ({ running: true }) };
  const manager = new PreviewManager({ registry, runtime, portDetector: { detect: async () => { throw new Error('port timeout'); } } });
  await assert.rejects(() => manager.start({ sessionId: 'session-1', detectedRuntime }), /port timeout/);
  assert.equal(registry.value().status, 'FAILED');
  assert.match(registry.value().failure_reason, /port timeout/);
});

test('종료된 dev server를 reconcile하면 FAILED 처리한다', async () => {
  const registry = registryFake();
  registry.updateRuntime('preview-1', { containerId: 'container-1' });
  registry.updateStatus('preview-1', 'RUNNING');
  const manager = new PreviewManager({ registry, runtime: { inspect: async () => ({ running: false, exitCode: 137 }) }, portDetector: {} });
  const preview = await manager.reconcile('preview-1');
  assert.equal(preview.status, 'FAILED');
  assert.match(preview.failure_reason, /137/);
});
