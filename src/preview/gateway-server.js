import http from 'node:http';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const TARGET_PATTERN = /^agent-hub-preview-[a-z0-9_.-]{1,110}$/;

function configFromEnv() {
  const token = process.env.PREVIEW_INTERNAL_TOKEN || '';
  if (token.length < 32) throw new Error('PREVIEW_INTERNAL_TOKEN은 32자 이상이어야 합니다.');
  return {
    host: process.env.PREVIEW_GATEWAY_HOST || '0.0.0.0',
    port: Number(process.env.PREVIEW_GATEWAY_PORT || 8080),
    routeApi: process.env.PREVIEW_ROUTE_API || 'http://agent-telegram:8790',
    token
  };
}

function hostnameFromRequest(req) {
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (!host || /[\s/@\\]/.test(host)) throw new Error('invalid host');
  try { return new URL(`http://${host}`).hostname; }
  catch { throw new Error('invalid host'); }
}

function filteredHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !HOP_BY_HOP.has(key.toLowerCase())));
}

async function resolveTarget(req, config) {
  const hostname = hostnameFromRequest(req);
  const url = new URL('/internal/previews/route', config.routeApi);
  url.searchParams.set('hostname', hostname);
  const response = await fetch(url, { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'preview not found' : 'preview unavailable');
    error.statusCode = response.status === 404 ? 404 : 503;
    throw error;
  }
  const route = await response.json();
  if (!TARGET_PATTERN.test(String(route.targetHost || '')) || !Number.isInteger(route.targetPort) || route.targetPort < 1 || route.targetPort > 65535) {
    throw new Error('invalid route response');
  }
  return route;
}

function unavailable(res, error) {
  const statusCode = error?.statusCode || 502;
  if (!res.headersSent) res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(statusCode === 404 ? 'Preview not found' : 'Preview unavailable');
}

export function createPreviewGateway(config) {
  const server = http.createServer(async (req, res) => {
    try {
      const target = await resolveTarget(req, config);
      const headers = filteredHeaders(req.headers);
      headers.host = `${target.targetHost}:${target.targetPort}`;
      headers['x-forwarded-host'] = req.headers.host;
      headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const upstream = http.request({ host: target.targetHost, port: target.targetPort, method: req.method, path: req.url, headers }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, filteredHeaders(upstreamRes.headers));
        upstreamRes.pipe(res);
      });
      upstream.on('error', (error) => unavailable(res, error));
      req.pipe(upstream);
    } catch (error) { unavailable(res, error); }
  });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const target = await resolveTarget(req, config);
      const headers = { ...req.headers, host: `${target.targetHost}:${target.targetPort}`, connection: 'Upgrade', upgrade: req.headers.upgrade || 'websocket' };
      const upstream = http.request({ host: target.targetHost, port: target.targetPort, method: req.method, path: req.url, headers });
      upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamRes.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) upstreamSocket.write(head);
        if (upstreamHead.length) socket.write(upstreamHead);
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
      });
      upstream.on('error', () => socket.destroy());
      upstream.end();
    } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = configFromEnv();
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('올바르지 않은 PREVIEW_GATEWAY_PORT입니다.');
  const server = createPreviewGateway(config);
  server.listen(config.port, config.host, () => console.log(`[Preview Gateway] 시작: ${config.host}:${config.port}`));
}
