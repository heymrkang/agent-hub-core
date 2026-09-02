import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PreviewDataPolicyError, PreviewSecurityPolicy } from '../../src/preview/preview-security-policy.js';

test('실제 Cloudflare Access challenge를 확인한 경우에만 외부 공개를 승인한다', async () => {
  const env = {
    PREVIEW_TUNNEL_ONLY: 'true',
    PREVIEW_CLOUDFLARE_TEAM_DOMAIN: 'https://agent-hub.cloudflareaccess.com',
    PREVIEW_CLOUDFLARE_ACCESS_AUD: 'a'.repeat(32)
  };
  const approved = new PreviewSecurityPolicy({ env, fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://agent-hub.cloudflareaccess.com/cdn-cgi/access/login' }
    });
  } });
  assert.equal(await approved.verifyExternalAccess('https://preview-api.12190529.xyz'), true);

  const openOrigin = new PreviewSecurityPolicy({ env, fetchImpl: async () => new Response('public', { status: 200 }) });
  assert.equal(await openOrigin.verifyExternalAccess('https://preview-api.12190529.xyz'), false);

  const lookalike = new PreviewSecurityPolicy({ env, fetchImpl: async () => new Response(null, {
    status: 302,
    headers: { location: 'https://agent-hub.cloudflareaccess.com.evil.example/cdn-cgi/access/login' }
  }) });
  assert.equal(await lookalike.verifyExternalAccess('https://preview-api.12190529.xyz'), false);

  const unconfigured = new PreviewSecurityPolicy({ env: {}, fetchImpl: async () => { throw new Error('should not run'); } });
  assert.equal(await unconfigured.verifyExternalAccess('https://preview-api.12190529.xyz'), false);

  const failedProbe = new PreviewSecurityPolicy({ env, fetchImpl: async () => { throw new Error('network timeout'); } });
  assert.equal(await failedProbe.verifyExternalAccess('https://preview-api.12190529.xyz'), false);

  const invalidAudience = new PreviewSecurityPolicy({
    env: { ...env, PREVIEW_CLOUDFLARE_ACCESS_AUD: 'too-short' },
    fetchImpl: async () => { throw new Error('should not run'); }
  });
  assert.equal(await invalidAudience.verifyExternalAccess('https://preview-api.12190529.xyz'), false);
});

test('.env.preview가 없으면 환경 변수 없이 정상 준비한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-preview-policy-'));
  try {
    const prepared = new PreviewSecurityPolicy({ env: {} }).prepareRuntime({ projectPath: root });
    assert.equal(prepared.previewEnvironmentFile, null);
    assert.deepEqual(prepared.previewEnvironment, {});
    assert.equal(prepared.maskEnvironmentFiles, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('선택 프로젝트 루트의 .env.preview만 사용하고 DB 종류를 제한하지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-preview-policy-'));
  try {
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(root, '.env.preview'), [
      'DATABASE_URL=mariadb://example.invalid/dev',
      'MONGODB_URI=mongodb://example.invalid/dev',
      'REDIS_URL=redis://example.invalid/0'
    ].join('\n'));
    fs.writeFileSync(path.join(nested, '.env.preview'), 'SHOULD_NOT_LOAD=true\n');

    const prepared = new PreviewSecurityPolicy({ env: {} }).prepareRuntime({ projectPath: root });
    assert.equal(prepared.previewEnvironmentFile, path.join(root, '.env.preview'));
    assert.deepEqual(prepared.previewEnvironment, {
      DATABASE_URL: 'mariadb://example.invalid/dev',
      MONGODB_URI: 'mongodb://example.invalid/dev',
      REDIS_URL: 'redis://example.invalid/0'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('.env.preview의 예약 변수와 symlink를 거부한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-preview-policy-'));
  try {
    const filename = path.join(root, '.env.preview');
    fs.writeFileSync(filename, 'NODE_OPTIONS=--require=/workspace/hook.js\n');
    assert.throws(
      () => new PreviewSecurityPolicy({ env: {} }).prepareRuntime({ projectPath: root }),
      (error) => error instanceof PreviewDataPolicyError && error.code === 'PREVIEW_ENV_RESERVED'
    );

    fs.rmSync(filename);
    fs.symlinkSync(path.join(root, 'missing-env'), filename);
    assert.throws(
      () => new PreviewSecurityPolicy({ env: {} }).prepareRuntime({ projectPath: root }),
      (error) => error instanceof PreviewDataPolicyError && error.code === 'UNSAFE_PREVIEW_ENV'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
