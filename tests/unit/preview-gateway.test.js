import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createPreviewGateway, rewriteOpenApiDocument, sanitizeOpenApiDocument } from '../../src/preview/gateway-server.js';

const token = 'test-token-that-is-at-least-32-characters-long';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server) { await new Promise((resolve) => server.close(resolve)); }

async function gatewayHarness(upstreamHandler, route = {}) {
  const upstream = http.createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const routeApi = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      targetHost: 'agent-hub-preview-preview-1', targetPort: upstreamPort,
      runtimeType: 'BACKEND_API', openapiJsonPath: '/docs-json', ...route
    }));
  });
  const routePort = await listen(routeApi);
  const gateway = createPreviewGateway({
    routeApi: `http://127.0.0.1:${routePort}`,
    token,
    logger: { log() {}, warn() {}, error() {} },
    request: (options, callback) => http.request({ ...options, host: '127.0.0.1' }, callback)
  });
  const gatewayPort = await listen(gateway);
  return {
    upstream,
    routeApi,
    gateway,
    request({ method = 'GET', path = '/', headers = {}, body = null } = {}) {
      return new Promise((resolve, reject) => {
        const request = http.request({
          host: '127.0.0.1', port: gatewayPort, method, path,
          headers: { host: 'api-preview.12190529.xyz', ...headers }
        }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({
            status: response.statusCode,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks).toString('utf8')
          }));
        });
        request.on('error', reject);
        request.end(body);
      });
    },
    async close() {
      gateway.closeAllConnections();
      await close(gateway); await close(routeApi); await close(upstream);
    }
  };
}

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

test('Preview hostname의 /health는 Gateway health에 가로막히지 않고 API로 전달된다', async () => {
  const harness = await gatewayHarness((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'api-ok' }));
  });
  try {
    const response = await harness.request({ path: '/health' });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 'api-ok' });
  } finally { await harness.close(); }
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

test('Gateway는 API method/query/body와 application header를 손실 없이 전달한다', async () => {
  const received = [];
  const harness = await gatewayHarness((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const multipart = '--fixture\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--fixture--\r\n';
  try {
    const getResponse = await harness.request({
      path: '/items?tag=a%20b&limit=2',
      headers: { accept: 'application/json', authorization: 'Bearer fixture-secret', origin: 'https://api-preview.12190529.xyz' }
    });
    await harness.request({ method: 'POST', path: '/items', headers: { 'content-type': 'application/json' }, body: '{"name":"alpha"}' });
    await harness.request({ method: 'PATCH', path: '/items/1', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=beta' });
    await harness.request({ method: 'DELETE', path: '/items/1' });
    await harness.request({ method: 'POST', path: '/upload', headers: { 'content-type': 'multipart/form-data; boundary=fixture' }, body: multipart });

    assert.deepEqual(received.map(({ method, url }) => [method, url]), [
      ['GET', '/items?tag=a%20b&limit=2'], ['POST', '/items'], ['PATCH', '/items/1'], ['DELETE', '/items/1'], ['POST', '/upload']
    ]);
    assert.equal(received[0].headers.authorization, 'Bearer fixture-secret');
    assert.equal(received[0].headers.accept, 'application/json');
    assert.equal(received[0].headers.origin, 'https://api-preview.12190529.xyz');
    assert.equal(received[0].headers.host, 'api-preview.12190529.xyz');
    assert.equal(received[0].headers['x-forwarded-host'], 'api-preview.12190529.xyz');
    assert.equal(received[0].headers['x-forwarded-proto'], 'https');
    assert.equal(received[0].headers['x-forwarded-port'], '443');
    assert.ok(received[0].headers['x-forwarded-for']);
    assert.equal(received[1].body, '{"name":"alpha"}');
    assert.equal(received[2].body, 'name=beta');
    assert.equal(received[4].headers['content-type'], 'multipart/form-data; boundary=fixture');
    assert.equal(received[4].body, multipart);
    assert.equal(getResponse.headers['access-control-allow-origin'], undefined);
  } finally { await harness.close(); }
});

test('Gateway는 Cookie를 전달하고 Set-Cookie를 Preview host 전용으로 격리한다', async () => {
  let requestCookie;
  const harness = await gatewayHarness((req, res) => {
    requestCookie = req.headers.cookie;
    res.setHeader('set-cookie', [
      'sid=abc; Domain=agent-hub-preview-preview-1; Path=/api; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/docs; Secure'
    ]);
    res.end('ok');
  });
  try {
    const response = await harness.request({ headers: { cookie: 'session=fixture; mode=dev' } });
    assert.equal(requestCookie, 'session=fixture; mode=dev');
    assert.deepEqual(response.headers['set-cookie'], [
      'sid=abc; Path=/api; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/docs; Secure'
    ]);
  } finally { await harness.close(); }
});

test('Gateway는 SSE response를 buffering 없이 streaming한다', async () => {
  let releaseSecond;
  const waitForRelease = new Promise((resolve) => { releaseSecond = resolve; });
  const harness = await gatewayHarness(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write('event: fixture\ndata: first\n\n');
    await waitForRelease;
    res.end('event: fixture\ndata: second\n\n');
  });
  try {
    await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: harness.gateway.address().port, path: '/events', headers: { host: 'api-preview.12190529.xyz' } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.includes('data: first') && !body.includes('data: second')) releaseSecond();
        });
        response.on('end', () => {
          assert.match(body, /data: first[\s\S]+data: second/);
          resolve();
        });
      });
      request.on('error', reject);
      request.end();
    });
  } finally { await harness.close(); }
});

test('Gateway는 OpenAPI JSON의 내부 server URL만 Preview same-origin으로 바꾼다', async () => {
  let acceptedEncoding;
  const harness = await gatewayHarness((req, res) => {
    acceptedEncoding = req.headers['accept-encoding'];
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('etag', 'internal-document-etag');
    res.end(JSON.stringify({
      openapi: '3.1.0',
      servers: [
        { url: 'http://agent-hub-preview-preview-1:3000/api?x=1' },
        { url: 'http://localhost:3000/v1' },
        { url: '/relative' },
        { url: 'https://external.example.com/api' }
      ],
      info: { title: 'fixture', version: '1' },
      paths: {},
      example: { url: 'http://agent-hub-preview-preview-1:3000/do-not-rewrite' }
    }));
  });
  try {
    const response = await harness.request({ path: '/docs-json?cache=0', headers: { 'x-forwarded-proto': 'https' } });
    const document = JSON.parse(response.body);
    assert.equal(acceptedEncoding, 'identity');
    assert.equal(response.headers.etag, undefined);
    assert.deepEqual(document.servers.map(({ url }) => url), [
      'https://api-preview.12190529.xyz/api?x=1',
      'https://api-preview.12190529.xyz/v1',
      '/relative',
      'https://external.example.com/api'
    ]);
    assert.equal(document.example.url, 'http://agent-hub-preview-preview-1:3000/do-not-rewrite');
  } finally { await harness.close(); }
});

test('Gateway는 sanitize할 수 없는 OpenAPI JSON을 외부로 전달하지 않는다', async () => {
  const harness = await gatewayHarness((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"openapi":"3.1.0","password":"leaked-secret"');
  });
  try {
    const response = await harness.request({ path: '/docs-json' });
    assert.equal(response.status, 502);
    assert.doesNotMatch(response.body, /leaked-secret/);
  } finally { await harness.close(); }
});

test('Gateway는 일반 JSON payload를 rewrite하지 않고 내부 redirect만 외부 origin으로 보정한다', async () => {
  const harness = await gatewayHarness((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://agent-hub-preview-preview-1:3000/docs?from=api' });
      return res.end();
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ url: 'http://agent-hub-preview-preview-1:3000/private' }));
  });
  try {
    const payload = await harness.request({ path: '/items' });
    assert.equal(JSON.parse(payload.body).url, 'http://agent-hub-preview-preview-1:3000/private');
    const redirect = await harness.request({ path: '/redirect' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, 'https://api-preview.12190529.xyz/docs?from=api');
  } finally { await harness.close(); }
});

test('Swagger v2 host/schemes도 외부 Preview origin으로 제한해 Try it out을 same-origin으로 둔다', () => {
  const req = { headers: { host: 'api-preview.12190529.xyz', 'x-forwarded-proto': 'https' } };
  const route = { targetHost: 'agent-hub-preview-preview-1' };
  const document = rewriteOpenApiDocument({ swagger: '2.0', host: 'localhost:3000', schemes: ['http'], basePath: '/api' }, { req, route });
  assert.equal(document.host, 'api-preview.12190529.xyz');
  assert.deepEqual(document.schemes, ['https']);
  assert.equal(document.basePath, '/api');
});

test('OpenAPI example과 extension에 섞인 실제 secret을 외부 응답에서 제거한다', () => {
  const document = sanitizeOpenApiDocument({
    openapi: '3.1.0',
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: { Login: { properties: { password: { type: 'string', format: 'password' } } } }
    },
    paths: {
      '/login': { post: { requestBody: { content: { 'application/json': { example: {
        password: 'actual-password', authorization: 'Bearer actual-token-value', note: 'token=embedded-secret'
      } } } } } }
    },
    'x-database-url': 'mariadb://user:password@prod.internal/app'
  });
  const serialized = JSON.stringify(document);
  assert.doesNotMatch(serialized, /actual-password|actual-token-value|embedded-secret|prod\.internal/);
  assert.equal(document.components.schemas.Login.properties.password.type, 'string');
  assert.equal(document.components.securitySchemes.bearer.scheme, 'bearer');
});
