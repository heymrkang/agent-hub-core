export const RESOURCE_THRESHOLDS = Object.freeze({
  memory: Object.freeze({ warn: 85, critical: 95 }),
  disk: Object.freeze({ warn: 80, critical: 90 }),
  cpu: Object.freeze({ warn: 85, critical: 95 })
});

export function usageSeverity(value, thresholds) {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value >= thresholds.critical) return 'CRITICAL';
  if (value >= thresholds.warn) return 'WARN';
  return 'OK';
}

export function cpuSeverity({ usagePercent, load1, cores }, thresholds = RESOURCE_THRESHOLDS.cpu) {
  if (![usagePercent, load1, cores].every(Number.isFinite) || cores < 1) return 'UNKNOWN';
  const normalizedLoad = load1 / cores * 100;
  // CPU는 순간 사용률 하나만으로 CRITICAL 처리하지 않는다.
  if (usagePercent >= thresholds.critical && normalizedLoad >= thresholds.critical) return 'CRITICAL';
  if (usagePercent >= thresholds.warn || normalizedLoad >= thresholds.warn) return 'WARN';
  return 'OK';
}

export function worstSeverity(values) {
  const rank = { UNKNOWN: 0, OK: 1, WARN: 2, CRITICAL: 3, OFFLINE: 4 };
  return values.reduce((worst, value) => rank[value] > rank[worst] ? value : worst, 'UNKNOWN');
}
