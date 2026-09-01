import crypto from 'crypto';
import { SessionManager } from '../../sessions/session-manager.js';
import { providerManager } from '../../providers/provider-manager.js';
import { modelCatalog } from '../../providers/model-catalog.js';
import { HandoffManager } from '../../context/handoff-manager.js';
import { isStealthMode, uiStatusIcon, uiTitle } from '../renderer/ui-theme.js';

function selectedMark(selected) { return selected ? (isStealthMode() ? '● ' : '🟢 ') : (isStealthMode() ? '○ ' : '⚪ '); }
function nav(label, normalIcon) { return `${isStealthMode() ? '' : `${normalIcon} `}${label}`; }

export async function handleModelCommand(bot, msg) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;
  const userId = msg.from.id;
  try {
    const active = SessionManager.getActiveSession(userId);
    const providers = providerManager.listProviderNames();
    const text = `${uiTitle('🤖', '모델 및 프로바이더 설정')}\n\n${isStealthMode() ? '▪' : '📌'} **활성 세션**: **${escapeMd(active.title)}**\n• 현재 Provider: \`${active.active_provider}\`\n• 현재 Model: \`${active.active_model || '기본 모델 (CLI Default)'}\`\n• 현재 Thinking: \`${active.reasoning_effort || 'default'}\`\n\n변경할 Provider를 선택하세요:`;
    const buttons = providers.map((p) => [{
      text: `${selectedMark(p === active.active_provider)}${p.toUpperCase()}${p === active.active_provider ? ' (선택됨)' : ''}`,
      callback_data: `model_provider:${p}`
    }]);
    const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

    if (msg.message_id && !msg.chat) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msg.message.message_id, ...options }).catch((error) => {
        if (!error.message.includes('message is not modified')) throw error;
      });
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    console.error(`[Command /model Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 모델 설정 실패: ${error.message}`);
  }
}

async function renderModelsForProvider(bot, { chatId, messageId, userId, providerName }) {
  const active = SessionManager.getActiveSession(userId);
  const models = modelCatalog.getModels(providerName);
  const state = modelCatalog.getCacheState(providerName);

  if (!models.length) {
    const text = `${uiTitle('📭', `[${providerName.toUpperCase()}] 모델 캐시가 비어 있습니다.`)}\n\n아직 백그라운드 조회가 완료되지 않았거나 마지막 조회가 실패했습니다.${state.last_error ? `\n\n최근 오류: ${escapeMd(state.last_error.slice(0, 300))}` : ''}`;
    return editModelMessage(bot, chatId, messageId, text, {
      inline_keyboard: [
        [{ text: nav('지금 조회', '🔄'), callback_data: `model_refresh:${providerName}` }],
        [{ text: nav('Provider 목록으로', '🔙'), callback_data: 'model_back_to_providers' }]
      ]
    });
  }

  const age = state.last_success_at ? formatAge(state.last_success_at) : '알 수 없음';
  const text = `${uiTitle('🎛️', `[${providerName.toUpperCase()}] 지원 모델 목록`)}\n\n${isStealthMode() ? '▪' : '📌'} **활성 세션**: **${escapeMd(active.title)}**\n${isStealthMode() ? '▪' : '📦'} 캐시: \`${state.status}\` · 마지막 갱신: \`${age}\`\n\n원하는 모델을 선택하세요:`;

  const buttons = models.map((m) => [{
    text: `${selectedMark(active.active_provider === providerName && active.active_model === m.id)}${m.name}${m.isDefault ? ' · Default' : ''}`,
    callback_data: `model_pick:${providerName}:${modelToken(m.id)}`
  }]);
  buttons.push([
    { text: nav('모델 목록 새로고침', '🔄'), callback_data: `model_refresh:${providerName}` },
    { text: nav('Provider 목록', '🔙'), callback_data: 'model_back_to_providers' }
  ]);

  return editModelMessage(bot, chatId, messageId, text, { inline_keyboard: buttons });
}

async function showModelsForProvider(bot, q, providerName) {
  await bot.answerCallbackQuery(q.id).catch((error) => console.warn(`[Model UI] answerCallbackQuery 실패: ${error.message}`));
  return renderModelsForProvider(bot, { chatId: q.message.chat.id, messageId: q.message.message_id, userId: q.from.id, providerName });
}

async function refreshModels(bot, q, providerName) {
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  const userId = q.from.id;
  await bot.answerCallbackQuery(q.id, { text: '백그라운드 모델 조회를 시작합니다.' }).catch((error) => console.warn(`[Model Refresh] answerCallbackQuery 실패: ${error.message}`));

  await editModelMessage(bot, chatId, messageId, `${isStealthMode() ? '[WAIT]' : '⏳'} **[${providerName.toUpperCase()}] 모델 목록 갱신 중...**\n\n기존 캐시는 유지됩니다.`, { inline_keyboard: [] });

  try {
    const result = await modelCatalog.refresh(providerName, { force: true });
    console.log(`[Model Refresh] ${providerName}: 갱신 성공, ${result.models.length}개 모델 UI 렌더링 시작.`);
    await renderModelsForProvider(bot, { chatId, messageId, userId, providerName });
    console.log(`[Model Refresh] ${providerName}: Telegram 모델 목록 렌더링 완료.`);
  } catch (error) {
    const cached = modelCatalog.getModels(providerName);
    const suffix = cached.length ? '\n\n기존 캐시는 유지했습니다.' : '\n\n사용 가능한 기존 캐시가 없습니다.';
    await editModelMessage(bot, chatId, messageId, `${uiStatusIcon('error')} **모델 갱신 실패**\n\n${escapeMd(error.message)}${suffix}`, {
      inline_keyboard: [
        [{ text: nav('다시 시도', '🔄'), callback_data: `model_refresh:${providerName}` }],
        [{ text: nav('Provider 목록', '🔙'), callback_data: 'model_back_to_providers' }]
      ]
    });
  }
}

async function renderThinking(bot, q, providerName, model) {
  const active = SessionManager.getActiveSession(q.from.id);
  const { levels, providerDefault } = modelCatalog.getReasoningOptions(providerName, model.id);
  const text = `${uiTitle('🧠', 'Thinking 선택')}\n\n• Provider: \`${providerName}\`\n• Model: \`${escapeMd(model.name)}\`\n• Provider Default: \`${providerDefault || '미공개'}\`\n\n해당 모델이 지원하는 사고 레벨만 표시한다.`;
  const buttons = levels.map((level) => [{
    text: `${selectedMark(active.active_provider === providerName && active.active_model === model.id && (active.reasoning_effort || 'default') === level)}${level}`,
    callback_data: `model_apply:${providerName}:${modelToken(model.id)}:${level}`
  }]);
  buttons.push([{ text: nav('모델 목록', '🔙'), callback_data: `model_provider:${providerName}` }]);
  return editModelMessage(bot, q.message.chat.id, q.message.message_id, text, { inline_keyboard: buttons });
}

async function showSuccess(bot, q, providerName, modelId, reasoningEffort) {
  const active = SessionManager.getActiveSession(q.from.id);
  return editModelMessage(bot, q.message.chat.id, q.message.message_id,
    `${uiStatusIcon('success')} **모델 설정 완료**\n\n${isStealthMode() ? '▪' : '📌'} **세션**: **${escapeMd(active.title)}**\n${isStealthMode() ? '▪' : '🤖'} **Provider**: \`${providerName.toUpperCase()}\`\n${isStealthMode() ? '▪' : '🧠'} **Model**: \`${modelId}\`\n${isStealthMode() ? '▪' : '⚙️'} **Thinking**: \`${reasoningEffort}\``,
    { inline_keyboard: [[{ text: nav('다른 모델로 변경', '🔄'), callback_data: `model_provider:${providerName}` }]] });
}

export async function handleModelCallback(bot, q) {
  const data = q.data;
  const userId = q.from.id;
  if (data === 'model_back_to_providers') { await handleModelCommand(bot, q); await bot.answerCallbackQuery(q.id).catch(() => {}); return; }
  if (data.startsWith('model_provider:')) return showModelsForProvider(bot, q, data.replace('model_provider:', ''));
  if (data.startsWith('model_refresh:')) return refreshModels(bot, q, data.replace('model_refresh:', ''));
  if (data.startsWith('model_pick:')) {
    const [, providerName, token] = data.split(':');
    const cached = modelCatalog.getModels(providerName);
    const selected = cached.find((m) => modelToken(m.id) === token);
    if (!selected) return bot.answerCallbackQuery(q.id, { text: '모델 캐시가 갱신되었습니다. 목록을 다시 열어 선택해주세요.', show_alert: true }).catch(() => {});
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return renderThinking(bot, q, providerName, selected);
  }
  if (data.startsWith('model_apply:')) {
    const [, providerName, token, effort] = data.split(':');
    const selected = modelCatalog.getModels(providerName).find((m) => modelToken(m.id) === token);
    if (!selected) return bot.answerCallbackQuery(q.id, { text: '모델 캐시가 갱신됐다. 다시 선택해라.', show_alert: true }).catch(() => {});
    const active = SessionManager.getActiveSession(userId);
    try {
      const validated = modelCatalog.validateReasoningEffort(providerName, selected.id, effort);
      await HandoffManager.executeHandoff({ sessionId: active.id, fromProvider: active.active_provider, toProvider: providerName, targetModel: selected.id, reasoningEffort: validated });
      await bot.answerCallbackQuery(q.id, { text: '모델/Thinking 적용 완료' }).catch(() => {});
      return showSuccess(bot, q, providerName, selected.id, validated);
    } catch (error) {
      return bot.answerCallbackQuery(q.id, { text: `변경 실패: ${error.message}`.slice(0, 180), show_alert: true }).catch(() => {});
    }
  }
}

function modelToken(modelId) { return crypto.createHash('sha256').update(String(modelId)).digest('hex').slice(0, 16); }
async function editModelMessage(bot, chatId, messageId, text, replyMarkup) {
  try { return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: replyMarkup }); }
  catch (error) { if (error.message?.includes('message is not modified')) return null; console.error(`[Model UI] Telegram editMessageText 실패: chat=${chatId}, message=${messageId}, error=${error.message}`); throw error; }
}
function formatAge(sqlDate) { const t = Date.parse(sqlDate.replace(' ', 'T') + 'Z'); if (!Number.isFinite(t)) return sqlDate; const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); if (m < 1) return '방금 전'; if (m < 60) return `${m}분 전`; const h = Math.floor(m / 60); return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`; }
function escapeMd(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
