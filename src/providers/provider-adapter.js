/**
 * Provider Adapter 공통 추상 클래스
 */
export class ProviderAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * CLI 설치 및 실행 가능 여부를 점검한다.
   * @returns {Promise<{ healthy: boolean, version?: string, error?: string }>}
   */
  async checkHealth() {
    throw new Error(`[${this.name}] checkHealth()가 구현되지 않았습니다.`);
  }

  /**
   * 인증 상태를 점검한다.
   * @returns {Promise<{ authenticated: boolean, details?: string, loginUrl?: string }>}
   */
  async checkAuth() {
    throw new Error(`[${this.name}] checkAuth()가 구현되지 않았습니다.`);
  }

  /**
   * CLI를 통해 지원 모델 목록을 동적으로 조회한다.
   * @returns {Promise<Array<{ id: string, name: string, description?: string, default?: boolean }>>}
   */
  async discoverModels() {
    throw new Error(`[${this.name}] discoverModels()가 구현되지 않았습니다.`);
  }

  /**
   * 기능 지원 상태를 반환한다. (SUPPORTED | PARTIAL | UNSUPPORTED)
   * @returns {object}
   */
  getCapabilities() {
    return {
      authPersistence: 'SUPPORTED',
      nonInteractive: 'SUPPORTED',
      jsonOutput: 'UNSUPPORTED',
      nativeSessionResume: 'UNSUPPORTED',
      modelSwitching: 'SUPPORTED',
      dynamicModelDiscovery: 'UNSUPPORTED',
      multiImage: 'UNSUPPORTED',
      nativeCompact: 'UNSUPPORTED',
      usageMetrics: 'UNSUPPORTED',
      reasoningEffort: 'UNSUPPORTED'
    };
  }

  // Provider가 신뢰할 수 있는 값을 노출할 때만 Auto Compact를 활성화한다.
  async getContextWindowTokens() { return null; }
  async countPromptTokens() { return null; }

  /**
   * 프롬프트를 비대화형으로 실행한다.
   * @param {object} options { prompt, model, reasoningEffort, sessionId, profile, cwd, signal }
   * @returns {Promise<{ response: string, rawEvents?: Array<any> }>}
   */
  async executePrompt(options) {
    throw new Error(`[${this.name}] executePrompt()가 구현되지 않았습니다.`);
  }

  /**
   * 컨텍스트 압축을 요청한다.
   * @param {object} options
   * @returns {Promise<{ success: boolean, beforeTokens?: number, afterTokens?: number, message?: string }>}
   */
  async compact(options) {
    return {
      success: false,
      message: `[${this.name}] Native compact 기능은 지원되지 않습니다 (UNSUPPORTED).`
    };
  }

  /**
   * 사용량/쿼터를 조회한다.
   * @returns {Promise<object|null>}
   */
  async getUsageQuota() { return { provider: this.name, windows: [], status: 'UNAVAILABLE', source: null, fetchedAt: new Date().toISOString() }; }
}
