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
    token,
    accessLog: process.env.PREVIEW_GATEWAY_ACCESS_LOG === 'true'
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
  const logger = config.logger || console;
  const routedTargets = new Map();
  const logRoute = (hostname, target) => {
    const value = `${target.targetHost}:${target.targetPort}`;
    if (routedTargets.get(hostname) === value) return;
    logger.log(`[Preview Gateway] 라우팅 연결: host=${hostname} target=${value}`);
    routedTargets.set(hostname, value);
  };
  const server = http.createServer(async (req, res) => {
    let hostname = 'invalid';
    try {
      hostname = hostnameFromRequest(req);
      const target = await resolveTarget(req, config);
      logRoute(hostname, target);
      const headers = filteredHeaders(req.headers);
      headers.host = `${target.targetHost}:${target.targetPort}`;
      headers['x-forwarded-host'] = req.headers.host;
      headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const upstream = http.request({ host: target.targetHost, port: target.targetPort, method: req.method, path: req.url, headers }, (upstreamRes) => {
        if (config.accessLog) logger.log(`[Preview Gateway] 요청: host=${hostname} method=${req.method} path=${req.url} status=${upstreamRes.statusCode || 502}`);
        res.writeHead(upstreamRes.statusCode || 502, filteredHeaders(upstreamRes.headers));
        upstreamRes.pipe(res);
      });
      upstream.on('error', (error) => {
        logger.error(`[Preview Gateway] upstream 연결 실패: host=${hostname} target=${target.targetHost}:${target.targetPort} error=${error.message}`);
        unavailable(res, error);
      });
      req.pipe(upstream);
    } catch (error) {
      logger.warn(`[Preview Gateway] 라우팅 실패: host=${hostname} status=${error?.statusCode || 502} reason=${error.message}`);
      unavailable(res, error);
    }
  });

  server.on('upgrade', async (req, socket, head) => {
    let hostname = 'invalid';
    try {
      hostname = hostnameFromRequest(req);
      const target = await resolveTarget(req, config);
      logRoute(hostname, target);
      const headers = { ...req.headers, host: `${target.targetHost}:${target.targetPort}`, connection: 'Upgrade', upgrade: req.headers.upgrade || 'websocket' };
      const upstream = http.request({ host: target.targetHost, port: target.targetPort, method: req.method, path: req.url, headers });
      upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        logger.log(`[Preview Gateway] WebSocket 연결: host=${hostname} target=${target.targetHost}:${target.targetPort}`);
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamRes.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) upstreamSocket.write(head);
        if (upstreamHead.length) socket.write(upstreamHead);
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
      });
      upstream.on('error', (error) => {
        logger.error(`[Preview Gateway] WebSocket 연결 실패: host=${hostname} target=${target.targetHost}:${target.targetPort} error=${error.message}`);
        socket.destroy();
      });
      upstream.end();
    } catch (error) {
      logger.warn(`[Preview Gateway] WebSocket 라우팅 실패: host=${hostname} reason=${error.message}`);
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = configFromEnv();
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('올바르지 않은 PREVIEW_GATEWAY_PORT입니다.');
  const server = createPreviewGateway(config);
  server.listen(config.port, config.host, () => console.log(`[Preview Gateway] 시작: ${config.host}:${config.port}`));
}
