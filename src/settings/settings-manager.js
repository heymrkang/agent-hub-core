import { getDb } from '../database/index.js';

export const SETTING_DEFINITIONS = Object.freeze({
  default_provider: { type: 'enum', values: ['codex', 'antigravity'], default: 'codex' },
  default_model_codex: { type: 'string', default: '' },
  default_model_antigravity: { type: 'string', default: '' },
  default_execution_profile: {
    type: 'enum',
    values: ['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'],
    default: 'WORKSPACE'
  },
  concurrency_limit: { type: 'integer', min: 1, max: 16, default: 2 },
  auto_compact_threshold: { type: 'integer', min: 50, max: 95, default: 80 },
  auto_session_title: { type: 'boolean', default: true },
  notifications_enabled: { type: 'boolean', default: true },
  stealth_mode: { type: 'enum', values: ['NORMAL', 'STEALTH'], default: 'NORMAL' },
  timezone: { type: 'timezone', default: process.env.TZ || 'Asia/Seoul' },
  preview_idle_timeout_hours: { type: 'integer', min: 0, max: 48, default: 24 },
  preview_max_concurrent: { type: 'integer', min: 1, max: 3, default: 3 }
});

function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeValue(key, value) {
  const definition = SETTING_DEFINITIONS[key];
  if (!definition) throw new Error(`지원하지 않는 설정입니다: ${key}`);

  switch (definition.type) {
    case 'enum': {
      const normalized = String(value);
      if (!definition.values.includes(normalized)) {
        throw new Error(`${key} 값이 올바르지 않습니다.`);
      }
      return normalized;
    }
    case 'integer': {
      const normalized = Number(value);
      if (!Number.isInteger(normalized) || normalized < definition.min || normalized > definition.max) {
        throw new Error(`${key} 값은 ${definition.min}~${definition.max} 범위의 정수여야 합니다.`);
      }
      return normalized;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1' || value === 1) return true;
      if (value === 'false' || value === '0' || value === 0) return false;
      throw new Error(`${key} 값은 boolean이어야 합니다.`);
    }
    case 'timezone': {
      const normalized = String(value).trim();
      if (!validateTimezone(normalized)) throw new Error(`올바르지 않은 timezone입니다: ${normalized}`);
      return normalized;
    }
    case 'string':
      return String(value ?? '').trim();
    default:
      throw new Error(`지원하지 않는 설정 타입입니다: ${definition.type}`);
  }
}

function serialize(value) {
  return JSON.stringify(value);
}

function deserialize(key, rawValue) {
  try {
    return normalizeValue(key, JSON.parse(rawValue));
  } catch {
    return SETTING_DEFINITIONS[key].default;
  }
}

export class SettingsManager {
  constructor(db = getDb()) {
    this.db = db;
    this.getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    this.listStmt = db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key');
    this.upsertStmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);
    this.deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
  }

  get(key) {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) throw new Error(`지원하지 않는 설정입니다: ${key}`);
    const row = this.getStmt.get(key);
    return row ? deserialize(key, row.value) : definition.default;
  }

  has(key) {
    if (!SETTING_DEFINITIONS[key]) throw new Error(`지원하지 않는 설정입니다: ${key}`);
    return Boolean(this.getStmt.get(key));
  }

  getAll() {
    const rows = new Map(this.listStmt.all().map((row) => [row.key, row]));
    return Object.fromEntries(
      Object.keys(SETTING_DEFINITIONS).map((key) => {
        const row = rows.get(key);
        return [key, row ? deserialize(key, row.value) : SETTING_DEFINITIONS[key].default];
      })
    );
  }

  set(key, value) {
    const normalized = normalizeValue(key, value);
    this.upsertStmt.run(key, serialize(normalized));
    console.log(`[Settings] ${key} 변경 완료`);
    return normalized;
  }

  reset(key) {
    if (!SETTING_DEFINITIONS[key]) throw new Error(`지원하지 않는 설정입니다: ${key}`);
    this.deleteStmt.run(key);
    console.log(`[Settings] ${key} 기본값 복원 완료`);
    return SETTING_DEFINITIONS[key].default;
  }

  resetAll() {
    const keys = Object.keys(SETTING_DEFINITIONS);
    const tx = this.db.transaction(() => {
      for (const key of keys) this.deleteStmt.run(key);
    });
    tx();
    console.log('[Settings] 전체 설정 기본값 복원 완료');
    return this.getAll();
  }

  describe() {
    return Object.fromEntries(
      Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => [
        key,
        { ...definition, value: this.get(key) }
      ])
    );
  }
}

let settingsManager = null;

export function initSettingsManager(db = getDb()) {
  if (!settingsManager) settingsManager = new SettingsManager(db);
  return settingsManager;
}

export function getSettingsManager() {
  if (!settingsManager) throw new Error('SettingsManager가 초기화되지 않았습니다.');
  return settingsManager;
}
