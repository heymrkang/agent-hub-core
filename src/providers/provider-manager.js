import { CodexAdapter } from './codex/codex-adapter.js';
import { AntigravityAdapter } from './antigravity/antigravity-adapter.js';

class ProviderManager {
  constructor() {
    this.adapters = new Map();
    this.initDefaultAdapters();
  }

  initDefaultAdapters() {
    // 1. Codex Adapter 등록
    const codex = new CodexAdapter();
    this.registerAdapter(codex);

    // 2. Antigravity Adapter 등록
    const antigravity = new AntigravityAdapter();
    this.registerAdapter(antigravity);

    // 백그라운드 모델 목록 사전 캐싱 (UI 지연 제거)
    setTimeout(() => {
      this.prefetchModels().catch(() => {});
    }, 1000);
  }

  /**
   * 모든 프로바이더의 모델 목록을 백그라운드에서 미리 로드하여 메모리 캐싱한다.
   */
  async prefetchModels() {
    console.log('[ProviderManager] 모델 목록 백그라운드 프리페치 시작...');
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.discoverModels();
      } catch {}
    }
    console.log('[ProviderManager] 모델 목록 사전 캐싱 완료.');
  }

  /**
   * 새 어댑터를 등록한다.
   * @param {import('./provider-adapter.js').ProviderAdapter} adapter
   */
  registerAdapter(adapter) {
    this.adapters.set(adapter.name.toLowerCase(), adapter);
    console.log(`[ProviderManager] Provider 등록 완료: ${adapter.name}`);
  }

  /**
   * 특정 프로바이더 어댑터를 반환한다.
   * @param {string} name
   * @returns {import('./provider-adapter.js').ProviderAdapter}
   */
  getAdapter(name = 'codex') {
    const adapter = this.adapters.get(name.toLowerCase());
    if (!adapter) {
      throw new Error(`지원하지 않는 Provider입니다: ${name}`);
    }
    return adapter;
  }

  /**
   * 등록된 모든 프로바이더의 이름 목록을 반환한다.
   * @returns {Array<string>}
   */
  listProviderNames() {
    return Array.from(this.adapters.keys());
  }

  /**
   * 전체 프로바이더의 헬스 및 상태 종합 정보를 조회한다.
   * @returns {Promise<Array<object>>}
   */
  async getProvidersStatus() {
    const results = [];
    for (const [name, adapter] of this.adapters.entries()) {
      try {
        const health = await adapter.checkHealth();
        const auth = await adapter.checkAuth();
        const capabilities = adapter.getCapabilities();
        results.push({
          name,
          healthy: health.healthy,
          version: health.version || '알 수 없음',
          authenticated: auth.authenticated,
          authDetails: auth.details,
          capabilities
        });
      } catch (error) {
        results.push({
          name,
          healthy: false,
          error: error.message
        });
      }
    }
    return results;
  }
}

export const providerManager = new ProviderManager();
