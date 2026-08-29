import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewRouteError, PreviewRouteService, normalizePreviewHostname } from '../../src/preview/preview-route-service.js';

const containerId = 'a'.repeat(64);

function registryFake(preview) {
  let touches = 0;
  return {
    getByHostname: (hostname) => hostname === preview?.public_hostname ? preview : null,
    touchActivity: () => { touches += 1; },
    touches: () => touches
  };
}

test('RUNNING Preview만 고정 container/port target으로 해석하고 activity를 갱신한다', () => {
  const preview = { id: 'preview-1', public_hostname: 'app-a31f.12190529.xyz', status: 'RUNNING', container_id: containerId, port: 3000 };
  const registry = registryFake(preview);
  const route = new PreviewRouteService({ registry }).resolve('APP-A31F.12190529.XYZ.');
  assert.deepEqual(route, { previewId: 'preview-1', hostname: preview.public_hostname, targetHost: 'agent-hub-preview-preview-1', targetPort: 3000 });
  assert.equal(registry.touches(), 1);
});

test('없는 hostname과 정지 Preview는 route를 반환하지 않는다', () => {
  const missing = new PreviewRouteService({ registry: registryFake(null) });
  assert.throws(() => missing.resolve('missing.12190529.xyz'), (error) => error instanceof PreviewRouteError && error.statusCode === 404);
  const stopped = new PreviewRouteService({ registry: registryFake({ public_hostname: 'app.12190529.xyz', status: 'STOPPED' }) });
  assert.throws(() => stopped.resolve('app.12190529.xyz'), (error) => error.code === 'UNAVAILABLE');
});

test('임의 hostname과 잘못된 Registry target을 거부한다', () => {
  assert.throws(() => normalizePreviewHostname('127.0.0.1:3000'), (error) => error.code === 'INVALID_HOSTNAME');
  assert.throws(() => normalizePreviewHostname('evil.test/path'), (error) => error.code === 'INVALID_HOSTNAME');
  const registry = registryFake({ public_hostname: 'app.12190529.xyz', status: 'RUNNING', container_id: 'localhost', port: 80 });
  assert.throws(() => new PreviewRouteService({ registry }).resolve('app.12190529.xyz'), (error) => error.code === 'INVALID_TARGET');
  assert.equal(registry.touches(), 0);
});
