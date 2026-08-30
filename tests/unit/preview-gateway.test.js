import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
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
    assert.equal(req.headers.host, 'app-a31f.12190529.xyz');
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
    const result = await new Promise((resolve, reject) => {
      const request = originalRequest({
        host: '127.0.0.1',
        port: gatewayPort,
        method: 'POST',
        path: '/hello?q=1',
        headers: { host: 'app-a31f.12190529.xyz' }
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      request.on('error', reject);
      request.end('payload');
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { path: '/hello?q=1', body: 'payload' });
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

test('Gateway /health는 route API 없이 200을 응답한다', async () => {
  let routeRequests = 0;
  const routeApi = http.createServer((_req, res) => { routeRequests += 1; res.writeHead(500); res.end(); });
  const routePort = await listen(routeApi);
  const gateway = createPreviewGateway({ routeApi: `http://127.0.0.1:${routePort}`, token });
  const gatewayPort = await listen(gateway);
  try {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
    assert.equal(routeRequests, 0);
  } finally { await close(gateway); await close(routeApi); }
});

test('Gateway는 WebSocket upgrade를 raw TCP로 중계한다', async () => {
  const upstream = http.createServer();
  let upgradedSocket;
  upstream.on('upgrade', (req, socket, head) => {
    upgradedSocket = socket;
    assert.equal(req.url, '/_next/webpack-hmr');
    assert.equal(req.headers.host, 'app-a31f.12190529.xyz');
    assert.equal(req.headers['x-forwarded-host'], 'app-a31f.12190529.xyz');
    assert.equal(req.headers.origin, 'http://localhost');
    assert.equal(req.headers['x-forwarded-origin'], 'https://app-a31f.12190529.xyz');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (data) => socket.write(data));
  });
  const upstreamPort = await listen(upstream);
  const routeApi = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ targetHost: 'agent-hub-preview-preview-1', targetPort: upstreamPort }));
  });
  const routePort = await listen(routeApi);
  const originalConnect = net.connect;
  const gateway = createPreviewGateway({
    routeApi: `http://127.0.0.1:${routePort}`,
    token,
    logger: { log() {}, warn() {}, error() {} },
    connect: (options, callback) => originalConnect({ ...options, host: '127.0.0.1' }, callback)
  });
  const gatewayPort = await listen(gateway);
  try {
    await new Promise((resolve, reject) => {
      const client = originalConnect({ host: '127.0.0.1', port: gatewayPort }, () => {
        client.write('GET /_next/webpack-hmr HTTP/1.1\r\nHost: app-a31f.12190529.xyz\r\nOrigin: https://app-a31f.12190529.xyz\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      let response = '';
      let handshakeComplete = false;
      client.on('data', (chunk) => {
        response += chunk;
        if (!handshakeComplete && response.includes('\r\n\r\n')) {
          assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
          handshakeComplete = true;
          client.write('ping');
        } else if (handshakeComplete && response.endsWith('ping')) {
          client.destroy();
          resolve();
        }
      });
      client.on('error', reject);
    });
  } finally {
    upgradedSocket?.destroy();
    gateway.closeAllConnections();
    await close(gateway); await close(routeApi); await close(upstream);
  }
});

test('Gateway는 반복되는 unavailable 라우팅 경고를 제한한다', async () => {
  const logs = [];
  const routeApi = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
  const routePort = await listen(routeApi);
  const gateway = createPreviewGateway({ routeApi: `http://127.0.0.1:${routePort}`, token, logger: { log() {}, warn: (message) => logs.push(message), error() {} } });
  const gatewayPort = await listen(gateway);
  try {
    await fetch(`http://127.0.0.1:${gatewayPort}/`, { headers: { host: 'stopped.12190529.xyz' } });
    await fetch(`http://127.0.0.1:${gatewayPort}/`, { headers: { host: 'stopped.12190529.xyz' } });
    assert.equal(logs.filter((message) => message.includes('라우팅 실패')).length, 1);
  } finally { await close(gateway); await close(routeApi); }
});
