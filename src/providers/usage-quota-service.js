const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
const STALE_MAX_MS = 600_000;
const FORCE_COOLDOWN_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;

export class UsageQuotaService {
  constructor({ providerManager, now = () => Date.now(), timeoutMs = PROBE_TIMEOUT_MS } = {}) {
    this.providerManager = providerManager;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.entries = new Map();
  }

  async get(provider, { forceRefresh = false } = {}) {
    const name = String(provider).toLowerCase();
    const now = this.now();
    const entry = this.entries.get(name) || {};
    if (entry.inFlight) return entry.inFlight;
    if (forceRefresh && entry.lastForcedAt && now - entry.lastForcedAt < FORCE_COOLDOWN_MS) {
      return this.decorate(entry.value, 'COOLDOWN');
    }
    const ttl = entry.value?.status === 'ERROR' ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
    if (!forceRefresh && entry.value && now - entry.cachedAt < ttl) return this.decorate(entry.value, 'HIT');
    if (forceRefresh) entry.lastForcedAt = now;
    const promise = this.probe(name, entry).finally(() => { entry.inFlight = null; });
    entry.inFlight = promise;
    this.entries.set(name, entry);
    return promise;
  }

  async probe(name, entry) {
    try {
      const adapter = this.providerManager.getAdapter(name);
      const result = await withTimeout(adapter.getUsageQuota(), this.timeoutMs);
      const value = normalizeResult(name, result, this.now());
      entry.value = value;
      entry.cachedAt = this.now();
      if (value.status === 'AVAILABLE' || value.status === 'PARTIAL') entry.lastSuccess = value;
      return this.decorate(value, 'MISS');
    } catch (error) {
      const now = this.now();
      if (entry.lastSuccess && now - Date.parse(entry.lastSuccess.fetchedAt) <= STALE_MAX_MS) {
        const stale = { ...entry.lastSuccess, stale: true, error: safeError(error) };
        entry.value = stale; entry.cachedAt = now;
        return this.decorate(stale, 'STALE');
      }
      const value = { provider: name, windows: [], fetchedAt: new Date(now).toISOString(), source: null, status: 'ERROR', error: safeError(error) };
      entry.value = value; entry.cachedAt = now;
      return this.decorate(value, 'MISS');
    }
  }

  decorate(value, cache) { return { ...value, windows: (value?.windows || []).map(w => ({ ...w })), cache }; }
}

function normalizeResult(provider, result, now) {
  if (!result) return { provider, windows: [], fetchedAt: new Date(now).toISOString(), source: null, status: 'UNAVAILABLE' };
  return { provider, windows: [], fetchedAt: new Date(now).toISOString(), source: null, status: 'UNAVAILABLE', ...result, provider };
}

function safeError(error) {
  const message = error?.message || String(error);
  return message.replace(/[\r\n]+/g, ' ').replace(/(token|secret|password|credential)(?:\s*[=:]\s*|\s+)[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 180);
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('조회 시간 초과')), timeoutMs);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
