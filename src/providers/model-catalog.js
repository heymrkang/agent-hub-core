import { getDb } from '../database/index.js';
import { providerManager } from './provider-manager.js';

class ModelCatalog {
  constructor() {
    this.refreshing = new Map();
  }

  getModels(provider) {
    const db = getDb();
    return db.prepare(`
      SELECT model_id AS id, display_name AS name, is_default, metadata_json, discovered_at
      FROM provider_models WHERE provider = ? ORDER BY is_default DESC, display_name COLLATE NOCASE ASC
    `).all(provider.toLowerCase()).map((row) => ({
      ...row,
      isDefault: Boolean(row.is_default),
      metadata: row.metadata_json ? safeJson(row.metadata_json) : null
    }));
  }

  getModel(provider, modelId) {
    return this.getModels(provider).find((model) => model.id === modelId) || null;
  }

  getReasoningOptions(provider, modelId) {
    const model = this.getModel(provider, modelId);
    const levels = Array.isArray(model?.metadata?.reasoningEfforts) ? model.metadata.reasoningEfforts.filter(Boolean) : [];
    return {
      levels: ['default', ...new Set(levels.map(String))],
      providerDefault: model?.metadata?.defaultReasoningEffort || null
    };
  }

  validateReasoningEffort(provider, modelId, reasoningEffort) {
    const value = String(reasoningEffort || 'default');
    const { levels } = this.getReasoningOptions(provider, modelId);
    if (!levels.includes(value)) throw new Error(`[${provider}/${modelId}] Thinking '${value}'은 지원하지 않습니다. 허용: ${levels.join(', ')}`);
    return value;
  }

  getCacheState(provider) {
    const db = getDb();
    return db.prepare('SELECT * FROM provider_model_cache WHERE provider = ?').get(provider.toLowerCase()) || {
      provider: provider.toLowerCase(), status: 'EMPTY', last_attempt_at: null, last_success_at: null, last_error: null
    };
  }

  async refresh(provider, { force = true } = {}) {
    const name = provider.toLowerCase();
    if (this.refreshing.has(name)) return this.refreshing.get(name);
    const task = this._refresh(name, force).finally(() => this.refreshing.delete(name));
    this.refreshing.set(name, task);
    return task;
  }

  async _refresh(provider, force) {
    const db = getDb();
    const previous = this.getModels(provider);
    db.prepare(`
      INSERT INTO provider_model_cache(provider,status,last_attempt_at,updated_at)
      VALUES (?, 'REFRESHING', datetime('now'), datetime('now'))
      ON CONFLICT(provider) DO UPDATE SET status='REFRESHING', last_attempt_at=datetime('now'), updated_at=datetime('now')
    `).run(provider);

    try {
      const adapter = providerManager.getAdapter(provider);
      const models = await adapter.discoverModels(force);
      if (!Array.isArray(models) || models.length === 0) throw new Error('Provider가 유효한 모델 목록을 반환하지 않았습니다.');
      const normalized = models
        .filter((m) => m && m.id && (m.name || m.id))
        .map((m) => ({
          id: String(m.id),
          name: String(m.name || m.id),
          isDefault: Boolean(m.isDefault ?? m.default),
          metadata: m.metadata || null
        }));
      if (normalized.length === 0) throw new Error('Provider 모델 목록 파싱 결과가 비어 있습니다.');

      const replace = db.transaction(() => {
        db.prepare('DELETE FROM provider_models WHERE provider = ?').run(provider);
        const insert = db.prepare(`INSERT INTO provider_models(provider,model_id,display_name,is_default,metadata_json,discovered_at) VALUES (?,?,?,?,?,datetime('now'))`);
        for (const model of normalized) insert.run(provider, model.id, model.name, model.isDefault ? 1 : 0, model.metadata ? JSON.stringify(model.metadata) : null);
        db.prepare(`
          INSERT INTO provider_model_cache(provider,status,last_attempt_at,last_success_at,last_error,updated_at)
          VALUES (?, 'FRESH', datetime('now'), datetime('now'), NULL, datetime('now'))
          ON CONFLICT(provider) DO UPDATE SET status='FRESH',last_attempt_at=datetime('now'),last_success_at=datetime('now'),last_error=NULL,updated_at=datetime('now')
        `).run(provider);
      });
      replace();
      console.log(`[ModelCatalog] ${provider}: ${normalized.length}개 모델 캐시 갱신 완료.`);
      return { models: this.getModels(provider), state: this.getCacheState(provider) };
    } catch (error) {
      const status = previous.length > 0 ? 'STALE' : 'EMPTY';
      db.prepare(`
        INSERT INTO provider_model_cache(provider,status,last_attempt_at,last_error,updated_at)
        VALUES (?, ?, datetime('now'), ?, datetime('now'))
        ON CONFLICT(provider) DO UPDATE SET status=excluded.status,last_attempt_at=datetime('now'),last_error=excluded.last_error,updated_at=datetime('now')
      `).run(provider, status, String(error.message || error).slice(0, 1000));
      console.error(`[ModelCatalog] ${provider} refresh 실패 (${status}): ${error.message}`);
      throw error;
    }
  }

  async refreshAll() {
    const results = [];
    for (const provider of providerManager.listProviderNames()) {
      try { results.push({ provider, ok: true, ...(await this.refresh(provider)) }); }
      catch (error) { results.push({ provider, ok: false, error: error.message }); }
    }
    return results;
  }
}

function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }
export const modelCatalog = new ModelCatalog();
