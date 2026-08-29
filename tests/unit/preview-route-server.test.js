import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewRouteHandler } from '../../src/preview/preview-route-server.js';

const token = 'test-token-that-is-at-least-32-characters-long';

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('내부 Route API는 Bearer 인증 후에만 lookup을 허용한다', async () => {
  const handler = createPreviewRouteHandler({ routeService: { resolve: (hostname) => ({ hostname, targetHost: 'agent-hub-preview-preview-1', targetPort: 3000 }) }, token });
  await withServer(handler, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/internal/previews/route?hostname=app.example.com`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${baseUrl}/internal/previews/route?hostname=app.example.com`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).hostname, 'app.example.com');
  });
});

test('짧은 내부 인증 token으로 서버를 만들지 않는다', () => {
  assert.throws(() => createPreviewRouteHandler({ routeService: {}, token: 'short' }), /32자/);
});
