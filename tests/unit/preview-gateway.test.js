import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewGateway } from '../../src/preview/gateway-server.js';

const token = 'test-token-that-is-at-least-32-characters-long';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) { await new Promise((resolve) => server.close(resolve)); }

test('Gateway는 내부 API가 승인한 target으로 path/body를 proxy한다', async () => {
  const logs = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: req.url, body })); });
  });
  const upstreamPort = await listen(upstream);
  const routeApi = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ targetHost: 'agent-hub-preview-preview-1', targetPort: upstreamPort }));
  });
  const routePort = await listen(routeApi);
  const gateway = createPreviewGateway({ routeApi: `http://127.0.0.1:${routePort}`, token, logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message), error: (message) => logs.push(message) } });
  const gatewayPort = await listen(gateway);
  // Docker container IDs are DNS targets in production. Test DNS resolution by substituting localhost at request time.
  const originalRequest = http.request;
  http.request = function patchedRequest(options, ...args) {
    if (options?.host === 'agent-hub-preview-preview-1') options = { ...options, host: '127.0.0.1' };
    return originalRequest.call(this, options, ...args);
  };
  try {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/hello?q=1`, { method: 'POST', headers: { host: 'app-a31f.12190529.xyz' }, body: 'payload' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: '/hello?q=1', body: 'payload' });
    assert.equal(logs.filter((message) => message.includes('라우팅 연결')).length, 1);
  } finally {
    http.request = originalRequest;
    await close(gateway); await close(routeApi); await close(upstream);
  }
});

test('Gateway는 내부 API가 거부한 hostname을 unavailable로 처리한다', async () => {
  const logs = [];
  const routeApi = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  const routePort = await listen(routeApi);
  const gateway = createPreviewGateway({ routeApi: `http://127.0.0.1:${routePort}`, token, logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message), error: (message) => logs.push(message) } });
  const gatewayPort = await listen(gateway);
  try {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/`, { headers: { host: 'unknown.12190529.xyz' } });
    assert.equal(response.status, 404);
    assert.match(logs.at(-1), /라우팅 실패.*status=404/);
  } finally { await close(gateway); await close(routeApi); }
});
