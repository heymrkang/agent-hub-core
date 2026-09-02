import http from 'node:http';
import net from 'node:net';
import { redactSecrets } from '../utils/redact.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const TARGET_PATTERN = /^agent-hub-preview-[a-z0-9_.-]{1,110}$/;
const PREVIEW_PATH_PATTERN = /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/;
const OPENAPI_REWRITE_LIMIT = 4 * 1024 * 1024;

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

function isGatewayHealthRequest(req) {
  if (req.url === '/_agent-hub/health') return true;
  if (req.url !== '/health') return false;
  let hostname;
  try { hostname = hostnameFromRequest(req); }
  catch { return false; }
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
}

function connectionTokens(headers) {
  return new Set(String(headers.connection || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function filteredHeaders(headers) {
  const dynamicHopByHop = connectionTokens(headers);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => {
    const normalized = key.toLowerCase();
    return !HOP_BY_HOP.has(normalized) && !dynamicHopByHop.has(normalized);
  }));
}

function forwardedProto(req) {
  const value = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return value === 'http' || value === 'https' ? value : 'https';
}

function externalOrigin(req) {
  return `${forwardedProto(req)}://${String(req.headers.host).trim()}`;
}

function appendForwardedFor(value, address) {
  const current = String(value || '').trim();
  const remote = String(address || '').trim();
  return [current, remote].filter(Boolean).join(', ');
}

function requestHeaders(req, route) {
  const headers = filteredHeaders(req.headers);
  const proto = forwardedProto(req);
  headers.host = req.headers.host;
  headers['x-forwarded-host'] = req.headers.host;
  headers['x-forwarded-proto'] = proto;
  headers['x-forwarded-port'] = proto === 'https' ? '443' : '80';
  headers['x-forwarded-for'] = appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress);
  if (route.openapiJsonPath && new URL(req.url || '/', 'http://preview.internal').pathname === route.openapiJsonPath) {
    headers['accept-encoding'] = 'identity';
  }
  return headers;
}

function isInternalUrl(value, route, publicHostname) {
  let parsed;
  try { parsed = new URL(value); }
  catch { return null; }
  const hostname = parsed.hostname.toLowerCase();
  const internal = hostname === String(route.targetHost).toLowerCase()
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname === publicHostname;
  return internal ? parsed : null;
}

function rewriteAbsoluteUrl(value, req, route) {
  const parsed = isInternalUrl(value, route, hostnameFromRequest(req));
  if (!parsed) return value;
  return `${externalOrigin(req)}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function rewriteOpenApiDocument(document, { req, route }) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  if (Array.isArray(document.servers)) {
    for (const server of document.servers) {
      if (server && typeof server === 'object' && typeof server.url === 'string') {
        server.url = rewriteAbsoluteUrl(server.url, req, route);
      }
    }
  }
  if (typeof document.swagger === 'string' && typeof document.host === 'string') {
    let internalHost = '';
    try { internalHost = new URL(`http://${document.host}`).hostname.toLowerCase(); }
    catch { /* Invalid Swagger host stays unchanged. */ }
    if ([String(route.targetHost).toLowerCase(), 'localhost', '127.0.0.1', '0.0.0.0', '::1', hostnameFromRequest(req)].includes(internalHost)) {
      document.host = String(req.headers.host).trim();
      document.schemes = [forwardedProto(req)];
    }
  }
  return sanitizeOpenApiDocument(document);
}

const OPENAPI_SECRET_KEY = /^(?:x[_-]?)?(?:api[_-]?key|access[_-]?key|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|password|passwd|authorization)$/i;

export function sanitizeOpenApiDocument(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSecrets(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = sanitizeOpenApiDocument(value[index], seen);
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    if (OPENAPI_SECRET_KEY.test(key) && typeof item === 'string' && item) value[key] = '[REDACTED]';
    else value[key] = sanitizeOpenApiDocument(item, seen);
  }
  return value;
}

function rewriteSetCookie(value) {
  return String(value).split(';').map((part) => part.trim()).filter((part) => !/^domain\s*=/i.test(part)).join('; ');
}

function responseHeaders(headers, req, route) {
  const result = filteredHeaders(headers);
  if (result['set-cookie']) {
    const cookies = Array.isArray(result['set-cookie']) ? result['set-cookie'] : [result['set-cookie']];
    result['set-cookie'] = cookies.map(rewriteSetCookie);
  }
  if (typeof result.location === 'string') result.location = rewriteAbsoluteUrl(result.location, req, route);
  return result;
}

function isOpenApiResponse(req, upstreamRes, route) {
  if (!route.openapiJsonPath) return false;
  let pathname;
  try { pathname = new URL(req.url || '/', 'http://preview.internal').pathname; }
  catch { return false; }
  const contentType = String(upstreamRes.headers['content-type'] || '').toLowerCase();
  const contentEncoding = String(upstreamRes.headers['content-encoding'] || 'identity').toLowerCase();
  return pathname === route.openapiJsonPath
    && upstreamRes.statusCode >= 200
    && upstreamRes.statusCode < 300
    && /(?:application|text)\/(?:[^;]+\+)?json\b/.test(contentType)
    && (contentEncoding === '' || contentEncoding === 'identity');
}

function proxyOpenApiResponse(req, res, upstreamRes, route) {
  const chunks = [];
  let size = 0;
  let blocked = false;
  upstreamRes.on('data', (chunk) => {
    if (blocked) return;
    size += chunk.length;
    if (size > OPENAPI_REWRITE_LIMIT) {
      blocked = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  upstreamRes.on('end', () => {
    if (blocked) return unavailable(res, Object.assign(new Error('OpenAPI document too large'), { statusCode: 502 }));
    const original = Buffer.concat(chunks);
    let body;
    try {
      const document = JSON.parse(original.toString('utf8'));
      body = Buffer.from(JSON.stringify(rewriteOpenApiDocument(document, { req, route })));
    } catch {
      return unavailable(res, Object.assign(new Error('Invalid OpenAPI document'), { statusCode: 502 }));
    }
    const headers = responseHeaders(upstreamRes.headers, req, route);
    delete headers.etag;
    delete headers['content-md5'];
    headers['content-length'] = String(body.length);
    res.writeHead(upstreamRes.statusCode || 502, headers);
    res.end(body);
  });
  upstreamRes.on('error', (error) => {
    if (!res.headersSent) unavailable(res, error);
    else res.destroy(error);
  });
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
  if (route.openapiJsonPath !== null && route.openapiJsonPath !== undefined && !PREVIEW_PATH_PATTERN.test(String(route.openapiJsonPath))) {
    throw new Error('invalid route response');
  }
  return route;
}

function unavailable(res, error) {
  const statusCode = error?.statusCode || 502;
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(statusCode === 404 ? 'Preview not found' : 'Preview unavailable');
}

function serializeUpgradeRequest(req) {
  const headers = {
    ...filteredHeaders(req.headers),
    connection: 'Upgrade',
    upgrade: req.headers.upgrade || 'websocket',
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': forwardedProto(req),
    'x-forwarded-port': forwardedProto(req) === 'https' ? '443' : '80',
    'x-forwarded-for': appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress)
  };
  // Next.js dev servers reject HMR upgrades whose browser Origin is not in
  // next.config.allowedDevOrigins. Preview hostnames are generated dynamically,
  // so keep the public origin for diagnostics and present the already
  // gateway-authorized request as a local-origin request to Next.js only.
  if (String(req.url || '').startsWith('/_next/') && req.headers.origin) {
    headers['x-forwarded-origin'] = req.headers.origin;
    headers.origin = 'http://localhost';
  }
  const lines = Object.entries(headers).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => `${key}: ${item}`);
  });
  return `${req.method || 'GET'} ${req.url || '/'} HTTP/${req.httpVersion}\r\n${lines.join('\r\n')}\r\n\r\n`;
}

export function createPreviewGateway(config) {
  const logger = config.logger || console;
  const routedTargets = new Map();
  const routeWarnings = new Map();
  const warnRouteFailure = (kind, hostname, message, statusCode = null) => {
    const key = `${hostname}:${message}`;
    const now = Date.now();
    if (now - (routeWarnings.get(key) || 0) < 30_000) return;
    routeWarnings.set(key, now);
    const status = statusCode ? ` status=${statusCode}` : '';
    logger.warn(`[Preview Gateway] ${kind}: host=${hostname}${status} reason=${message}`);
  };
  const logRoute = (hostname, target) => {
    const value = `${target.targetHost}:${target.targetPort}`;
    if (routedTargets.get(hostname) === value) return;
    logger.log(`[Preview Gateway] 라우팅 연결: host=${hostname} target=${value}`);
    routedTargets.set(hostname, value);
  };
  const server = http.createServer(async (req, res) => {
    if (isGatewayHealthRequest(req)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('OK');
      return;
    }
    let hostname = 'invalid';
    try {
      hostname = hostnameFromRequest(req);
      const target = await resolveTarget(req, config);
      logRoute(hostname, target);
      const headers = requestHeaders(req, target);
      const upstreamRequest = config.request || http.request;
      const upstream = upstreamRequest({ host: target.targetHost, port: target.targetPort, method: req.method, path: req.url, headers }, (upstreamRes) => {
        if (config.accessLog) logger.log(`[Preview Gateway] 요청: host=${hostname} method=${req.method} path=${req.url} status=${upstreamRes.statusCode || 502}`);
        if (isOpenApiResponse(req, upstreamRes, target)) {
          proxyOpenApiResponse(req, res, upstreamRes, target);
          return;
        }
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders(upstreamRes.headers, req, target));
        upstreamRes.pipe(res);
      });
      upstream.on('error', (error) => {
        logger.error(`[Preview Gateway] upstream 연결 실패: host=${hostname} target=${target.targetHost}:${target.targetPort} error=${error.message}`);
        unavailable(res, error);
      });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    } catch (error) {
      warnRouteFailure('라우팅 실패', hostname, error.message, error?.statusCode || 502);
      unavailable(res, error);
    }
  });

  server.on('upgrade', async (req, socket, head) => {
    let hostname = 'invalid';
    try {
      hostname = hostnameFromRequest(req);
      const target = await resolveTarget(req, config);
      logRoute(hostname, target);
      const connect = config.connect || net.connect;
      const upstream = connect({ host: target.targetHost, port: target.targetPort }, () => {
        logger.log(`[Preview Gateway] WebSocket 연결: host=${hostname} target=${target.targetHost}:${target.targetPort}`);
        upstream.write(serializeUpgradeRequest(req));
        if (head.length) upstream.write(head);
        upstream.pipe(socket).pipe(upstream);
      });
      upstream.on('error', (error) => {
        logger.error(`[Preview Gateway] WebSocket 연결 실패: host=${hostname} path=${req.url} target=${target.targetHost}:${target.targetPort} code=${error.code || 'UNKNOWN'} error=${error.message}`);
        if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      });
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    } catch (error) {
      warnRouteFailure('WebSocket 라우팅 실패', hostname, error.message);
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
