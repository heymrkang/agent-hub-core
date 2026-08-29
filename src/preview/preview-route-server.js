import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { PreviewRegistry } from './preview-registry.js';
import { PreviewRouteError, PreviewRouteService } from './preview-route-service.js';

function authorized(value, expected) {
  const actual = String(value || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createPreviewRouteHandler({ routeService, token } = {}) {
  if (!routeService) throw new Error('Preview Route Service가 필요합니다.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('PREVIEW_INTERNAL_TOKEN은 32자 이상이어야 합니다.');
  return (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    if (!authorized(req.headers.authorization, token)) return sendJson(res, 401, { error: 'unauthorized' });
    let url;
    try { url = new URL(req.url, 'http://preview-route.internal'); }
    catch { return sendJson(res, 400, { error: 'bad_request' }); }
    if (url.pathname !== '/internal/previews/route') return sendJson(res, 404, { error: 'not_found' });
    try {
      return sendJson(res, 200, routeService.resolve(url.searchParams.get('hostname')));
    } catch (error) {
      if (error instanceof PreviewRouteError) return sendJson(res, error.statusCode, { error: error.code.toLowerCase() });
      console.error(`[Preview Route] lookup 실패: ${error.message}`);
      return sendJson(res, 500, { error: 'internal_error' });
    }
  };
}

export function startPreviewRouteServer({ registry = null } = {}) {
  const token = process.env.PREVIEW_INTERNAL_TOKEN || '';
  if (token.length < 32) {
    console.warn('[Preview Route] PREVIEW_INTERNAL_TOKEN이 없거나 32자 미만이라 내부 API를 시작하지 않습니다.');
    return null;
  }
  const host = process.env.PREVIEW_ROUTE_HOST || '0.0.0.0';
  const port = Number(process.env.PREVIEW_ROUTE_PORT || 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('올바르지 않은 PREVIEW_ROUTE_PORT입니다.');
  const routeService = new PreviewRouteService({ registry: registry || new PreviewRegistry() });
  const server = http.createServer(createPreviewRouteHandler({ routeService, token }));
  server.listen(port, host, () => console.log(`[Preview Route] 내부 API 시작: ${host}:${port}`));
  server.on('error', (error) => console.error(`[Preview Route] server 오류: ${error.message}`));
  return server;
}
