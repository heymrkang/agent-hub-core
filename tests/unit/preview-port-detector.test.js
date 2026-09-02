import test from 'node:test';
import assert from 'node:assert/strict';
import { portsFromLogs, PreviewPortDetector, PreviewPortDetectionError } from '../../src/preview/port-detector.js';

function runtime({ logs = [''], ports = [[]], running = true, exitCode = 0 } = {}) {
  let index = 0;
  return {
    inspect: async () => ({ running, exitCode }),
    logs: async () => logs[Math.min(index, logs.length - 1)],
    listeningPorts: async () => ports[Math.min(index++, ports.length - 1)]
  };
}

test('Next.js와 Vite ANSI 로그에서 실제 port를 감지한다', () => {
  assert.deepEqual(portsFromLogs('\u001b[32m- Local: http://localhost:3001\u001b[0m'), [3001]);
  assert.deepEqual(portsFromLogs('  ➜  Local:   http://localhost:5174/'), [5174]);
  assert.deepEqual(portsFromLogs('at bootstrap (/workspace/src/main.ts:31:9)'), []);
});

test('로그를 우선하고 listening socket을 보조 감지한다', async () => {
  const fromLog = new PreviewPortDetector({ runtime: runtime({ logs: ['Local: http://localhost:3010'], ports: [[3010, 9229]] }), timeoutMs: 20, pollIntervalMs: 1 });
  assert.equal(await fromLog.detect('container-1'), 3010);
  const fromSocket = new PreviewPortDetector({ runtime: runtime({ ports: [[4173]] }), timeoutMs: 20, pollIntervalMs: 1 });
  assert.equal(await fromSocket.detect('container-1'), 4173);
});

test('여러 socket은 추정하지 않고 timeout 후 수동 port를 요구한다', async () => {
  const detector = new PreviewPortDetector({ runtime: runtime({ ports: [[3000, 9229]] }), timeoutMs: 5, pollIntervalMs: 1 });
  await assert.rejects(() => detector.detect('container-1'), (error) => error instanceof PreviewPortDetectionError && error.code === 'PORT_DETECTION_TIMEOUT' && error.message.includes('listening_ports=3000,9229') && error.message.includes('수동 port'));
  const manual = new PreviewPortDetector({ runtime: runtime({ ports: [[8080]] }), timeoutMs: 5, pollIntervalMs: 1 });
  assert.equal(await manual.detect('container-1', { manualPort: 8080 }), 8080);
  await assert.rejects(() => detector.detect('container-1', { manualPort: 70000 }), (error) => error.code === 'INVALID_PORT');
});

test('준비 전에 dev server가 죽으면 즉시 실패한다', async () => {
  const detector = new PreviewPortDetector({ runtime: runtime({ running: false, exitCode: 1 }), timeoutMs: 20 });
  await assert.rejects(() => detector.detect('container-1'), (error) => error.code === 'PROCESS_EXITED' && error.message.includes('exit 1'));
});
