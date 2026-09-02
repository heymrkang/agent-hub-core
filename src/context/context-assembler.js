import { ContextManager } from './context-manager.js';
import { Compactor } from './compactor.js';
import { providerManager } from '../providers/provider-manager.js';
import { getSettingsManager } from '../settings/settings-manager.js';
import { runtimeConfig } from '../config/runtime-config.js';

const LONG_CODE_BLOCK_MIN_LINES = 5;
const CODE_BLOCK_OMISSION = '// ... [중략: 수백 줄의 이전 코드 블록 생략]';

function abbreviateLongCodeBlocks(text) {
  return text.replace(/(^[ \t]*```[^\r\n]*\r?\n)([\s\S]*?)(\r?\n[ \t]*```[ \t]*$)/gm, (block, opening, body, closing) => {
    const lines = body.split(/\r?\n/);
    if (lines.length < LONG_CODE_BLOCK_MIN_LINES) return block;
    return `${opening}${lines.slice(0, 2).join('\n')}\n${CODE_BLOCK_OMISSION}${closing}`;
  });
}

function renderHistory(messages) {
  if (!messages.length) return null;
  return `[이전 대화 기록 / Context]\n${messages.map((message) => {
    const text = message.role === 'assistant' ? abbreviateLongCodeBlocks(message.text) : message.text;
    return `${message.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
  }).join('\n\n')}`;
}

function joinPromptParts(parts) {
  return parts.filter((part) => part && String(part).trim()).join('\n\n');
}

export function selectCrossProviderDelta(messages, provider) {
  const pName = String(provider || '').toLowerCase();
  const rows = Array.isArray(messages) ? messages : [];
  const firstExternalAssistant = rows.findIndex((message) => {
    if (message?.role !== 'assistant' || !message?.provider) return false;
    return String(message.provider).toLowerCase() !== pName;
  });
  if (firstExternalAssistant < 0) return [];

  let start = firstExternalAssistant;
  if (start > 0 && rows[start - 1]?.role === 'user') start -= 1;
  return rows.slice(start);
}

export class ContextAssembler {
  static assemble({ sessionId, userMessageId = null, currentPrompt }) {
    const context = ContextManager.buildExecutionContext(sessionId, {
      excludeMessageId: userMessageId,
      tailSize: runtimeConfig.executionTailSize
    });
    const parts = [];
    if (context.rollingSummary) parts.push(`[대화 요약]\n${context.rollingSummary}`);
    const history = renderHistory(context.messages);
    if (history) parts.push(history);
    parts.push(currentPrompt);
    return { prompt: joinPromptParts(parts), context };
  }

  static async prepare({ session, userMessageId = null, currentPrompt }) {
    const build = () => this.assemble({ sessionId: session.id, userMessageId, currentPrompt });
    const initial = build();
    const adapter = providerManager.getAdapter(session.active_provider);
    const contextWindow = await adapter.getContextWindowTokens?.(session.active_model);
    const usedTokens = await adapter.countPromptTokens?.(initial.prompt, session.active_model);

    if (!Number.isFinite(contextWindow) || contextWindow <= 0 || !Number.isFinite(usedTokens) || usedTokens < 0) {
      return { ...initial, mode: 'BOOTSTRAP', autoCompact: { status: 'UNAVAILABLE', attempted: false } };
    }

    const threshold = getSettingsManager().get('auto_compact_threshold');
    const usagePercent = usedTokens / contextWindow * 100;
    if (usagePercent < threshold) {
      return { ...initial, mode: 'BOOTSTRAP', autoCompact: { status: 'BELOW_THRESHOLD', attempted: false, usedTokens, contextWindow, usagePercent, threshold } };
    }

    try {
      const result = await Compactor.compactSession(session.id);
      if (result.status !== 'COMPACTED') {
        return { ...initial, mode: 'BOOTSTRAP', autoCompact: { ...result, attempted: true, usedTokens, contextWindow, usagePercent, threshold } };
      }
      return { ...build(), mode: 'BOOTSTRAP', autoCompact: { ...result, attempted: true, usedTokens, contextWindow, usagePercent, threshold } };
    } catch (error) {
      console.warn(`[AutoCompact] session=${session.id} 실패, 압축 전 context로 계속: ${error.message}`);
      return { ...initial, mode: 'BOOTSTRAP', autoCompact: { status: 'FAILED', success: false, attempted: true, error: error.message, usedTokens, contextWindow, usagePercent, threshold } };
    }
  }

  /**
   * V2 provider-native execution router.
   * Global memory is not injected here; Codex/Antigravity load the mirrored native Rules files themselves.
   * - UNBOUND: one-time canonical bootstrap to create/adopt a native session.
   * - READY + same-provider continuation: current prompt only; native session owns history.
   * - READY + another Provider answered since this provider's cursor: one-time cross-provider delta, then current prompt.
   */
  static async prepareForProvider({ session, userMessageId = null, currentPrompt }) {
    const provider = String(session.active_provider || '').toLowerCase();
    const providerSession = ContextManager.getProviderSession(session.id, provider);

    if (!providerSession?.native_session_ref) {
      return this.prepare({ session, userMessageId, currentPrompt });
    }

    const parts = [];
    let missedMessages = [];
    if (providerSession.last_synced_message_id) {
      const delta = ContextManager.buildContextPackage(session.id, providerSession.last_synced_message_id);
      const priorRows = delta.messages.filter((message) => message.id !== userMessageId);
      missedMessages = selectCrossProviderDelta(priorRows, provider);
    }

    if (missedMessages.length > 0) {
      const history = renderHistory(missedMessages);
      parts.push(`[Provider Handoff Delta]\n다음 기록은 이 Provider native session이 마지막으로 처리한 turn 이후 다른 Provider에서 진행된 대화입니다. 이 내용을 현재 native conversation에 반영한 뒤 사용자의 새 요청을 이어서 처리하세요.\n\n${history}`);
    }

    parts.push(currentPrompt);

    return {
      prompt: joinPromptParts(parts),
      context: {
        sessionId: session.id,
        provider,
        nativeSessionRef: providerSession.native_session_ref,
        lastSyncedMessageId: providerSession.last_synced_message_id || null,
        missedMessageCount: missedMessages.length
      },
      mode: missedMessages.length > 0 ? 'NATIVE_DELTA' : 'NATIVE_CONTINUATION',
      autoCompact: { status: 'NATIVE_SESSION_BYPASS', attempted: false }
    };
  }
}
