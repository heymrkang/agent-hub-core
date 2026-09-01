import { ContextManager } from './context-manager.js';
import { Compactor } from './compactor.js';
import { providerManager } from '../providers/provider-manager.js';
import { getSettingsManager } from '../settings/settings-manager.js';

const EXECUTION_TAIL_SIZE = 10;

function renderHistory(messages) {
  if (!messages.length) return null;
  return `[\uC774\uC804 \uB300\uD654 \uAE30\uB85D / Context]\n${messages.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`).join('\n\n')}`;
}

export class ContextAssembler {
  static assemble({ sessionId, userMessageId = null, memoryBlock = null, currentPrompt }) {
    const context = ContextManager.buildExecutionContext(sessionId, {
      excludeMessageId: userMessageId,
      tailSize: EXECUTION_TAIL_SIZE
    });
    const parts = [];
    if (memoryBlock) parts.push(memoryBlock);
    if (context.rollingSummary) parts.push(`[\uB300\uD654 \uC694\uC57D]\n${context.rollingSummary}`);
    const history = renderHistory(context.messages);
    if (history) parts.push(history);
    parts.push(currentPrompt);
    return { prompt: parts.join('\n\n'), context };
  }

  static async prepare({ session, userMessageId = null, memoryBlock = null, currentPrompt }) {
    const build = () => this.assemble({ sessionId: session.id, userMessageId, memoryBlock, currentPrompt });
    const initial = build();
    const adapter = providerManager.getAdapter(session.active_provider);
    const contextWindow = await adapter.getContextWindowTokens?.(session.active_model);
    const usedTokens = await adapter.countPromptTokens?.(initial.prompt, session.active_model);

    if (!Number.isFinite(contextWindow) || contextWindow <= 0 || !Number.isFinite(usedTokens) || usedTokens < 0) {
      return { ...initial, autoCompact: { status: 'UNAVAILABLE', attempted: false } };
    }

    const threshold = getSettingsManager().get('auto_compact_threshold');
    const usagePercent = usedTokens / contextWindow * 100;
    if (usagePercent < threshold) {
      return { ...initial, autoCompact: { status: 'BELOW_THRESHOLD', attempted: false, usedTokens, contextWindow, usagePercent, threshold } };
    }

    try {
      const result = await Compactor.compactSession(session.id);
      if (result.status !== 'COMPACTED') {
        return { ...initial, autoCompact: { ...result, attempted: true, usedTokens, contextWindow, usagePercent, threshold } };
      }
      return { ...build(), autoCompact: { ...result, attempted: true, usedTokens, contextWindow, usagePercent, threshold } };
    } catch (error) {
      console.warn(`[AutoCompact] session=${session.id} 실패, 압축 전 context로 계속: ${error.message}`);
      return { ...initial, autoCompact: { status: 'FAILED', success: false, attempted: true, error: error.message, usedTokens, contextWindow, usagePercent, threshold } };
    }
  }
}
