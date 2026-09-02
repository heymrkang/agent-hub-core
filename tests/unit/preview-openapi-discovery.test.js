import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverNestSwaggerSourcePaths,
  isOpenApiJson,
  isSwaggerHtml,
  OpenApiDiscovery
} from '../../src/preview/openapi-discovery.js';

function response({ statusCode = 200, contentType, body = '' }) {
  return { reachable: true, statusCode, contentType, body };
}

test('Swagger HTML과 OpenAPI v2/v3 JSON을 실제 응답 signature로 판정한다', () => {
  assert.equal(isSwaggerHtml(response({ contentType: 'text/html; charset=utf-8', body: '<div id="swagger-ui"></div>' })), true);
  assert.equal(isSwaggerHtml(response({ contentType: 'text/html', body: '<h1>API docs</h1>' })), false);
  assert.equal(isOpenApiJson(response({ contentType: 'application/json', body: '{"openapi":"3.0.0","paths":{}}' })), true);
  assert.equal(isOpenApiJson(response({ contentType: 'application/problem+json', body: '{"swagger":"2.0"}' })), true);
  assert.equal(isOpenApiJson(response({ contentType: 'application/json', body: '{"message":"not found"}' })), false);
  assert.equal(isOpenApiJson(response({ statusCode: 404, contentType: 'application/json', body: '{"openapi":"3.0.0"}' })), false);
});

test('Nest bootstrap의 직접 문자열 Swagger 경로를 정적 탐지한다', () => {
  const projectPath = path.resolve('tests/fixtures/nest-openapi');
  assert.deepEqual(discoverNestSwaggerSourcePaths(projectPath), {
    uiPath: '/docs',
    jsonPath: '/docs-json'
  });
  assert.deepEqual(discoverNestSwaggerSourcePaths(path.resolve('tests/fixtures/nest-no-openapi')), {
    uiPath: null,
    jsonPath: null
  });
});

test('source 경로를 기본 후보보다 먼저 probe하고 endpoint를 모두 찾는다', async () => {
  const calls = [];
  const runtime = { probeHttp: async (_id, options) => {
    calls.push(options);
    if (options.path === '/docs') return response({ contentType: 'text/html', body: '<script>SwaggerUIBundle({})</script>' });
    if (options.path === '/docs-json') return response({ contentType: 'application/json; charset=utf-8', body: '{"openapi":"3.0.0"}' });
    if (options.path === '/health') return response({ contentType: 'application/json', body: '{"status":"ok"}' });
    return response({ statusCode: 404, contentType: 'application/json', body: '{}' });
  } };
  const discovery = new OpenApiDiscovery({ runtime });
  const result = await discovery.discover('container-1', {
    port: 3000,
    projectPath: path.resolve('tests/fixtures/nest-openapi')
  });
  assert.deepEqual(result, {
    openapiUiPath: '/docs', openapiJsonPath: '/docs-json', healthPath: '/health', warnings: []
  });
  assert.deepEqual(calls.map(({ path: requestPath }) => requestPath), ['/docs', '/docs-json', '/health']);
  assert.ok(calls.every(({ maxBodyBytes }) => maxBodyBytes === 1024 * 1024));
});

test('문서가 없거나 override가 틀려도 탐지 결과만 비활성화한다', async () => {
  const runtime = { probeHttp: async () => response({ statusCode: 404, contentType: 'application/json', body: '{"message":"not found"}' }) };
  const discovery = new OpenApiDiscovery({ runtime });
  const result = await discovery.discover('container-1', {
    port: 3000,
    openapiUiPath: '/wrong-docs',
    openapiJsonPath: '/wrong-openapi.json',
    healthPath: '/wrong-health'
  });
  assert.equal(result.openapiUiPath, null);
  assert.equal(result.openapiJsonPath, null);
  assert.equal(result.healthPath, null);
  assert.deepEqual(result.warnings, [
    'Swagger UI override 미탐지: /wrong-docs',
    'OpenAPI JSON override 미탐지: /wrong-openapi.json',
    'Health override 미탐지: /wrong-health'
  ]);
});

test('@nestjs/swagger가 설치돼도 bootstrap 설정과 HTTP 문서 응답이 없으면 오탐하지 않는다', async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-swagger-unconfigured-'));
  try {
    fs.mkdirSync(path.join(projectPath, 'src'));
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/swagger': '11.4.7' } }));
    fs.writeFileSync(path.join(projectPath, 'src/main.ts'), "await app.listen(3000, '0.0.0.0');\n");
    const runtime = { probeHttp: async (_id, options) => options.path === '/health'
      ? response({ contentType: 'application/json', body: '{"status":"ok"}' })
      : response({ statusCode: 404, contentType: 'application/json', body: '{}' }) };
    const result = await new OpenApiDiscovery({ runtime }).discover('container-1', { port: 3000, projectPath });
    assert.equal(result.openapiUiPath, null);
    assert.equal(result.openapiJsonPath, null);
    assert.equal(result.healthPath, '/health');
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('custom override만 probe해 문서 경로를 탐지한다', async () => {
  const calls = [];
  const runtime = { probeHttp: async (_id, options) => {
    calls.push(options.path);
    if (options.path === '/internal/docs') return response({ contentType: 'text/html', body: '<div class="swagger-ui"></div>' });
    if (options.path === '/internal/openapi') return response({ contentType: 'application/json', body: '{"swagger":"2.0"}' });
    return response({ statusCode: 204, contentType: '', body: '' });
  } };
  const result = await new OpenApiDiscovery({ runtime }).discover('container-1', {
    port: 3000,
    openapiUiPath: '/internal/docs',
    openapiJsonPath: '/internal/openapi',
    healthPath: '/ready'
  });
  assert.deepEqual(result, {
    openapiUiPath: '/internal/docs', openapiJsonPath: '/internal/openapi', healthPath: '/ready', warnings: []
  });
  assert.deepEqual(calls, ['/internal/docs', '/internal/openapi', '/ready']);
});
