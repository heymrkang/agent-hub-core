import 'dotenv/config';

const DEFINITIONS = Object.freeze({
  executionTailSize: { name: 'EXECUTION_TAIL_SIZE', defaultValue: 3 },
  codexTimeoutMs: { name: 'CODEX_TIMEOUT_MS', defaultValue: 120000 },
  antigravityTimeoutMs: { name: 'ANTIGRAVITY_TIMEOUT_MS', defaultValue: 120000 },
  antigravityModelDiscoveryTimeoutMs: { name: 'ANTIGRAVITY_MODEL_DISCOVERY_TIMEOUT_MS', defaultValue: 60000 },
  codexConcurrency: { name: 'CODEX_CONCURRENCY', defaultValue: 2 },
  antigravityConcurrency: { name: 'ANTIGRAVITY_CONCURRENCY', defaultValue: 2 },
  modelRefreshIntervalSeconds: { name: 'MODEL_REFRESH_INTERVAL_SECONDS', defaultValue: 21600, min: 3600 },
  schedulerQueueGraceSeconds: { name: 'SCHEDULER_QUEUE_GRACE_SECONDS', defaultValue: 30 }
});

export function readPositiveIntegerEnv(name, defaultValue, { env = process.env, min = 1 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min) {
    throw new Error(`[Config] ${name} must be an integer greater than or equal to ${min}: ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

export function loadRuntimeConfig(env = process.env) {
  return Object.freeze(Object.fromEntries(Object.entries(DEFINITIONS).map(([key, definition]) => [
    key,
    readPositiveIntegerEnv(definition.name, definition.defaultValue, { env, min: definition.min })
  ])));
}

export const runtimeConfig = loadRuntimeConfig();
