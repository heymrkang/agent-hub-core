import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewHttpReadiness, PreviewHttpReadinessError } from '../../src/preview/http-readiness.js';

function runtime({ probes, running = true, exitCode = 0 } = {}) {
  let index = 0;
  return {
    inspect: async () => ({ running, exitCode }),
    probeHttp: async () => probes[Math.min(index++, probes.length - 1)]
  };
}

test('404도 실제 HTTP 응답이면 readiness 성공으로 판정한다', async () => {
  const readiness = new PreviewHttpReadiness({
    runtime: runtime({ probes: [{ reachable: false, errorCode: 'ECONNREFUSED' }, { reachable: true, statusCode: 404, contentType: 'application/json' }] }),
    timeoutMs: 30,
    pollIntervalMs: 1
  });
  assert.deepEqual(await readiness.wait('container-1', { port: 3000 }), {
    port: 3000,
    path: '/',
    statusCode: 404,
    contentType: 'application/json'
  });
});

test('HTTP 응답이 없으면 bind 수정 힌트가 있는 timeout을 반환한다', async () => {
  const readiness = new PreviewHttpReadiness({
    runtime: runtime({ probes: [{ reachable: false, errorCode: 'ECONNREFUSED', errorMessage: 'connect refused' }] }),
    timeoutMs: 5,
    pollIntervalMs: 1,
    requestTimeoutMs: 1
  });
  await assert.rejects(() => readiness.wait('container-1', { port: 3000 }), (error) => (
    error instanceof PreviewHttpReadinessError
    && error.code === 'HTTP_READINESS_TIMEOUT'
    && error.message.includes('ECONNREFUSED')
    && error.message.includes('0.0.0.0')
  ));
});

test('HTTP 준비 전에 process가 종료되면 즉시 exit code를 진단한다', async () => {
  const readiness = new PreviewHttpReadiness({
    runtime: runtime({ probes: [], running: false, exitCode: 1 }),
    timeoutMs: 20
  });
  await assert.rejects(() => readiness.wait('container-1', { port: 3000 }), (error) => error.code === 'PROCESS_EXITED' && error.message.includes('exit 1'));
});

test('DNS와 Docker probe 오류는 timeout까지 재시도하지 않고 즉시 실패한다', async () => {
  let probeCalls = 0;
  const readiness = new PreviewHttpReadiness({
    runtime: {
      inspect: async () => ({ running: true, exitCode: 0 }),
      probeHttp: async () => {
        probeCalls += 1;
        return { reachable: false, errorCode: 'ENOTFOUND', errorMessage: 'host not found' };
      }
    },
    timeoutMs: 100,
    pollIntervalMs: 1
  });
  await assert.rejects(() => readiness.wait('container-1', { port: 3000 }), (error) => (
    error.code === 'HTTP_PROBE_FAILED' && error.message.includes('ENOTFOUND')
  ));
  assert.equal(probeCalls, 1);
});

test('runtime probe 자체 실패도 진단 가능한 오류로 즉시 변환한다', async () => {
  const readiness = new PreviewHttpReadiness({
    runtime: {
      inspect: async () => ({ running: true, exitCode: 0 }),
      probeHttp: async () => {
        const error = new Error('docker exec failed');
        error.code = 'HTTP_PROBE_FAILED';
        throw error;
      }
    },
    timeoutMs: 100
  });
  await assert.rejects(() => readiness.wait('container-1', { port: 3000 }), (error) => (
    error instanceof PreviewHttpReadinessError
    && error.code === 'HTTP_PROBE_FAILED'
    && error.message.includes('docker exec failed')
  ));
});
