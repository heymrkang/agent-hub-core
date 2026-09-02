import fs from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';

function accessConfig(env) {
  const teamDomain = String(env.PREVIEW_CLOUDFLARE_TEAM_DOMAIN || '').trim().toLowerCase();
  const audience = String(env.PREVIEW_CLOUDFLARE_ACCESS_AUD || '').trim();
  const configured = env.PREVIEW_TUNNEL_ONLY === 'true'
    && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/?$/.test(teamDomain)
    && audience.length >= 32;
  return { configured, teamDomain: teamDomain.replace(/\/$/, '') };
}

function isAccessChallenge(response, teamDomain) {
  const location = String(response?.headers?.get?.('location') || '');
  if (response?.status < 300 || response?.status >= 400 || !location) return false;
  try {
    const login = new URL(location);
    const configured = new URL(teamDomain);
    return login.protocol === 'https:'
      && login.hostname === configured.hostname
      && login.pathname.startsWith('/cdn-cgi/access/');
  } catch {
    return false;
  }
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV = new Set(['HOME', 'CI', 'NODE_OPTIONS', 'PATH', 'HOSTNAME']);
const MAX_ENV_FILE_BYTES = 1024 * 1024;

export class PreviewDataPolicyError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreviewDataPolicyError';
    this.code = code;
  }
}

function validatePreviewEnvironmentFile(filename) {
  let source;
  try {
    source = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    throw new PreviewDataPolicyError('PREVIEW_ENV_READ_FAILED', '.env.preview 파일을 읽을 수 없습니다.', error);
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_ENV_FILE_BYTES) {
    throw new PreviewDataPolicyError('PREVIEW_ENV_TOO_LARGE', '.env.preview 파일은 1 MiB를 초과할 수 없습니다.');
  }
  if (source.includes('\u0000')) {
    throw new PreviewDataPolicyError('INVALID_PREVIEW_ENV', '.env.preview 파일에 NUL 문자를 사용할 수 없습니다.');
  }

  const names = new Set();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    const name = separator >= 0 ? line.slice(0, separator).trim() : '';
    if (!ENV_NAME_PATTERN.test(name)) {
      throw new PreviewDataPolicyError('INVALID_PREVIEW_ENV', '.env.preview에는 NAME=value 형식만 사용할 수 있습니다.');
    }
    if (RESERVED_ENV.has(name)) {
      throw new PreviewDataPolicyError('PREVIEW_ENV_RESERVED', `Preview runtime 예약 환경 변수는 설정할 수 없습니다: ${name}`);
    }
    if (names.has(name)) {
      throw new PreviewDataPolicyError('DUPLICATE_PREVIEW_ENV', `중복된 Preview 환경 변수가 있습니다: ${name}`);
    }
    names.add(name);
  }
  const environment = parseDotenv(source);
  if (Object.keys(environment).length !== names.size) {
    throw new PreviewDataPolicyError('INVALID_PREVIEW_ENV', '.env.preview 파일을 해석할 수 없습니다.');
  }
  return Object.freeze(environment);
}

function selectPreviewEnvironmentFile(projectPath) {
  const filename = path.join(path.resolve(String(projectPath || '')), '.env.preview');
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ filename: null, environment: Object.freeze({}) });
    throw new PreviewDataPolicyError('PREVIEW_ENV_READ_FAILED', '.env.preview 파일 상태를 확인할 수 없습니다.', error);
  }
  if (!stat.isFile()) {
    throw new PreviewDataPolicyError('UNSAFE_PREVIEW_ENV', '.env.preview는 프로젝트 루트의 일반 파일이어야 합니다.');
  }
  return Object.freeze({ filename, environment: validatePreviewEnvironmentFile(filename) });
}

export class PreviewSecurityPolicy {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, accessProbeTimeoutMs = 5_000 } = {}) {
    this.env = env;
    this.fetch = fetchImpl;
    this.accessProbeTimeoutMs = accessProbeTimeoutMs;
  }

  async verifyExternalAccess(publicUrl) {
    const config = accessConfig(this.env);
    if (!config.configured || typeof this.fetch !== 'function') return false;
    try {
      const response = await this.fetch(publicUrl, {
        method: 'GET', redirect: 'manual', headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(this.accessProbeTimeoutMs)
      });
      return isAccessChallenge(response, config.teamDomain);
    } catch {
      return false;
    }
  }

  prepareRuntime(runtime = {}) {
    const selected = selectPreviewEnvironmentFile(runtime.projectPath);
    return Object.freeze({
      ...runtime,
      previewEnvironmentFile: selected.filename,
      previewEnvironment: selected.environment,
      maskEnvironmentFiles: true
    });
  }
}
