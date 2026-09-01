import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRuntimeConfig, readPositiveIntegerEnv } from '../../src/config/runtime-config.js';

test('runtime config uses documented defaults when values are unset', () => {
  assert.deepEqual(loadRuntimeConfig({}), {
    executionTailSize: 3,
    codexTimeoutMs: 120000,
    antigravityTimeoutMs: 120000,
    antigravityModelDiscoveryTimeoutMs: 60000,
    codexConcurrency: 2,
    antigravityConcurrency: 2,
    modelRefreshIntervalSeconds: 21600,
    schedulerQueueGraceSeconds: 30
  });
});

test('runtime config accepts valid environment overrides', () => {
  const config = loadRuntimeConfig({
    EXECUTION_TAIL_SIZE: '5',
    CODEX_TIMEOUT_MS: '180000',
    ANTIGRAVITY_TIMEOUT_MS: '240000',
    ANTIGRAVITY_MODEL_DISCOVERY_TIMEOUT_MS: '90000',
    CODEX_CONCURRENCY: '4',
    ANTIGRAVITY_CONCURRENCY: '8',
    MODEL_REFRESH_INTERVAL_SECONDS: '7200',
    SCHEDULER_QUEUE_GRACE_SECONDS: '45'
  });

  assert.equal(config.executionTailSize, 5);
  assert.equal(config.codexTimeoutMs, 180000);
  assert.equal(config.antigravityTimeoutMs, 240000);
  assert.equal(config.antigravityModelDiscoveryTimeoutMs, 90000);
  assert.equal(config.codexConcurrency, 4);
  assert.equal(config.antigravityConcurrency, 8);
  assert.equal(config.modelRefreshIntervalSeconds, 7200);
  assert.equal(config.schedulerQueueGraceSeconds, 45);
});

test('configured integer values fail fast when malformed or unsafe', () => {
  for (const value of ['abc', '1.5', '0', '-1', ' 3', '3x', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => readPositiveIntegerEnv('TEST_VALUE', 3, { env: { TEST_VALUE: value } }),
      /TEST_VALUE must be an integer greater than or equal to 1/
    );
  }
  assert.throws(
    () => loadRuntimeConfig({ MODEL_REFRESH_INTERVAL_SECONDS: '3599' }),
    /MODEL_REFRESH_INTERVAL_SECONDS must be an integer greater than or equal to 3600/
  );
});
