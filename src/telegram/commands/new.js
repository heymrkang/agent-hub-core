import { SessionManager } from '../../sessions/session-manager.js';
import { getSettingsManager } from '../../settings/settings-manager.js';
import { modelCatalog } from '../../providers/model-catalog.js';
import { isStealthMode, uiStatusIcon } from '../renderer/ui-theme.js';

function escapeMarkdown(value) {
  return String(value ?? '').replace(/([_*`\[])/g, '\\$1');
}

function resolveDefaultReasoning(provider, model, configuredEffort) {
  if (!model) return 'default';
  const cachedModel = modelCatalog.getModel(provider, model);
  if (!cachedModel) {
    console.warn(`[Command /new] 기본 모델 캐시 없음: ${provider}/${model}; Thinking은 default로 적용합니다.`);
    return 'default';
  }
  try {
    return modelCatalog.validateReasoningEffort(provider, model, configuredEffort || 'default');
  } catch (error) {
    console.warn(`[Command /new] 기본 Thinking 검증 실패: ${error.message}; default로 적용합니다.`);
    return 'default';
  }
}

export async function handleNewCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  try {
    const settings = getSettingsManager();
    const provider = settings.get('default_provider');
    const profile = settings.get('default_execution_profile');
    const model = settings.get(`default_model_${provider}`) || null;
    const configuredReasoning = settings.get(`default_reasoning_effort_${provider}`) || 'default';
    const reasoningEffort = resolveDefaultReasoning(provider, model, configuredReasoning);
    const newSession = SessionManager.createSession(userId, {
      title: '새 채팅',
      provider,
      model,
      reasoningEffort,
      profile
    });
    const stealth = isStealthMode();
    const title = escapeMarkdown(newSession.title);
    const activeProvider = escapeMarkdown(newSession.active_provider);
    const activeModel = escapeMarkdown(newSession.active_model || 'CLI Default');
    const activeThinking = escapeMarkdown(newSession.reasoning_effort || 'default');
    const executionProfile = escapeMarkdown(newSession.execution_profile);
    const text = stealth
      ? `${uiStatusIcon('success')} **새 세션이 생성되었습니다.**\n\n**제목**: ${title}\n**Provider**: ${activeProvider}\n**Model**: ${activeModel}\n**Thinking**: ${activeThinking}\n**Profile**: ${executionProfile}\n\n이제 메시지를 입력하시면 이 세션에 기록됩니다.`
      : `✨ **새 세션이 생성되었습니다.**\n\n📌 **제목**: ${title}\n🤖 **Provider**: ${activeProvider}\n🧠 **Model**: ${activeModel}\n💭 **Thinking**: ${activeThinking}\n⚙️ **Profile**: ${executionProfile}\n\n이제 메시지를 입력하시면 이 세션에 기록됩니다.`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /new Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 새 세션 생성 실패: ${error.message}`);
  }
}
