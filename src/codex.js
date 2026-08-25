import { providerManager } from './providers/provider-manager.js';

/**
 * 하위 호환용 래퍼 함수 (기존 테스트 또는 레거시 호출 대응)
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function executeCodex(prompt) {
  const adapter = providerManager.getAdapter('codex');
  const result = await adapter.executePrompt({ prompt });
  return result.response;
}
