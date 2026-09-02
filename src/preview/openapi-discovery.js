import fs from 'node:fs';
import path from 'node:path';
import { normalizePreviewPath } from './preview-contract.js';

const DEFAULT_UI_PATHS = Object.freeze(['/docs', '/api', '/swagger']);
const DEFAULT_JSON_PATHS = Object.freeze([
  '/docs-json', '/api-json', '/swagger-json', '/openapi.json', '/swagger.json'
]);
const DEFAULT_HEALTH_PATHS = Object.freeze(['/health', '/api/health']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function literalPath(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  return normalizePreviewPath(text.startsWith('/') ? text : `/${text}`, fieldName);
}

function sourceFiles(projectPath) {
  if (!projectPath || !path.isAbsolute(projectPath)) return [];
  const roots = [path.join(projectPath, 'src', 'main.ts'), path.join(projectPath, 'src', 'main.js')];
  return roots.filter((filename) => fs.existsSync(filename));
}

export function discoverNestSwaggerSourcePaths(projectPath) {
  for (const filename of sourceFiles(projectPath)) {
    let source;
    try { source = fs.readFileSync(filename, 'utf8'); } catch { continue; }
    const setup = source.match(/SwaggerModule\s*\.\s*setup\s*\(\s*(['"])([^'"\r\n]+)\1/);
    if (!setup) continue;
    const jsonOption = source.match(/jsonDocumentUrl\s*:\s*(['"])([^'"\r\n]+)\1/);
    return Object.freeze({
      uiPath: literalPath(setup[2], 'Swagger source UI path'),
      jsonPath: jsonOption ? literalPath(jsonOption[2], 'Swagger source JSON path') : null
    });
  }
  return Object.freeze({ uiPath: null, jsonPath: null });
}

function isSuccess(response) {
  return response?.reachable && response.statusCode >= 200 && response.statusCode < 300;
}

export function isSwaggerHtml(response) {
  if (!isSuccess(response) || !/^text\/html\b/i.test(response.contentType || '')) return false;
  const body = response.body || '';
  return /(?:SwaggerUIBundle|swagger-ui(?:\.css|\.js|\s|<|"|'))/i.test(body);
}

export function isOpenApiJson(response) {
  if (!isSuccess(response) || !/^(?:application|text)\/(?:[\w.+-]*\+)?json\b/i.test(response.contentType || '')) return false;
  try {
    const document = JSON.parse(response.body || '');
    return Boolean(document && !Array.isArray(document) && typeof document === 'object'
      && (typeof document.openapi === 'string' || typeof document.swagger === 'string'));
  } catch {
    return false;
  }
}

function isHealthResponse(response) {
  return isSuccess(response);
}

export class OpenApiDiscovery {
  constructor({ runtime, requestTimeoutMs = 2_000 } = {}) {
    if (!runtime) throw new Error('OpenAPI 탐지에는 Preview Runtime이 필요합니다.');
    this.runtime = runtime;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async #firstMatch(containerId, port, candidates, predicate, warnings, label) {
    for (const candidate of candidates) {
      try {
        const response = await this.runtime.probeHttp(containerId, {
          port,
          path: candidate,
          timeoutMs: this.requestTimeoutMs,
          maxBodyBytes: MAX_RESPONSE_BYTES
        });
        if (predicate(response)) return candidate;
      } catch (error) {
        warnings.push(`${label} ${candidate} probe 실패: ${error?.code || error?.message || String(error)}`);
      }
    }
    return null;
  }

  async discover(containerId, {
    port,
    projectPath = null,
    openapiUiPath = null,
    openapiJsonPath = null,
    healthPath = null
  } = {}) {
    const source = discoverNestSwaggerSourcePaths(projectPath);
    const uiOverride = literalPath(openapiUiPath, 'openapiUiPath');
    const jsonOverride = literalPath(openapiJsonPath, 'openapiJsonPath');
    const healthOverride = literalPath(healthPath, 'healthPath');
    const warnings = [];

    const uiCandidates = uiOverride ? [uiOverride] : unique([source.uiPath, ...DEFAULT_UI_PATHS]);
    const jsonCandidates = jsonOverride ? [jsonOverride] : unique([source.jsonPath, ...DEFAULT_JSON_PATHS]);
    const healthCandidates = healthOverride ? [healthOverride] : DEFAULT_HEALTH_PATHS;

    const openapiUi = await this.#firstMatch(containerId, port, uiCandidates, isSwaggerHtml, warnings, 'Swagger UI');
    const openapiJson = await this.#firstMatch(containerId, port, jsonCandidates, isOpenApiJson, warnings, 'OpenAPI JSON');
    const health = await this.#firstMatch(containerId, port, healthCandidates, isHealthResponse, warnings, 'Health');

    if (uiOverride && !openapiUi) warnings.push(`Swagger UI override 미탐지: ${uiOverride}`);
    if (jsonOverride && !openapiJson) warnings.push(`OpenAPI JSON override 미탐지: ${jsonOverride}`);
    if (healthOverride && !health) warnings.push(`Health override 미탐지: ${healthOverride}`);

    return Object.freeze({
      openapiUiPath: openapiUi,
      openapiJsonPath: openapiJson,
      healthPath: health,
      warnings: Object.freeze(warnings)
    });
  }
}
