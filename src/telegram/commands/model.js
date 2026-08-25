import { SessionManager } from '../../sessions/session-manager.js';
import { providerManager } from '../../providers/provider-manager.js';
import { HandoffManager } from '../../context/handoff-manager.js';

/**
 * /model 명령어 처리: 프로바이더 및 모델 선택 2단계 UI 제공
 */
export async function handleModelCommand(bot, msg) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;
  const userId = msg.from.id;

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const providers = providerManager.listProviderNames();

    let text = `🤖 **모델 및 프로바이더 설정**\n\n`;
    text += `📌 **활성 세션**: **${activeSession.title}**\n`;
    text += `• 현재 Provider: \`${activeSession.active_provider}\`\n`;
    text += `• 현재 Model: \`${activeSession.active_model || '기본 모델 (CLI Default)'}\`\n\n`;
    text += `변경할 Provider를 선택하세요:`;

    const buttons = [];
    for (const p of providers) {
      const isSelected = p === activeSession.active_provider;
      buttons.push([
        {
          text: isSelected ? `🟢 ${p.toUpperCase()} (선택됨)` : `⚪ ${p.toUpperCase()}`,
          callback_data: `model_provider:${p}`
        }
      ]);
    }

    const options = {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    };

    if (msg.message_id && !msg.chat) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msg.message.message_id,
          ...options
        });
      } catch (err) {
        if (!err.message.includes('message is not modified')) {
          throw err;
        }
      }
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    console.error(`[Command /model Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 모델 설정 실패: ${error.message}`);
  }
}

/**
 * 특정 프로바이더의 모델 목록 표시 (2단계)
 */
async function showModelsForProvider(bot, callbackQuery, providerName) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const adapter = providerManager.getAdapter(providerName);
    const models = await adapter.discoverModels();

    let text = `🎛️ **[${providerName.toUpperCase()}] 지원 모델 목록**\n\n`;
    text += `📌 **활성 세션**: **${activeSession.title}**\n`;
    text += `원하는 모델을 선택하면 현재 활성 세션에 즉시 적용됩니다:`;

    const buttons = [];
    for (const m of models) {
      const isCurrent =
        activeSession.active_provider === providerName &&
        (activeSession.active_model === m.id || (!activeSession.active_model && m.id === 'default'));

      const prefix = isCurrent ? '🟢 ' : '⚪ ';
      const label = `${prefix}${m.name}`;

      buttons.push([
        {
          text: label,
          callback_data: `model_select:${providerName}:${m.id}`
        }
      ]);
    }

    buttons.push([
      { text: '🔄 새로고침', callback_data: `model_refresh:${providerName}` },
      { text: '🔙 Provider 목록으로', callback_data: 'model_back_to_providers' }
    ]);

    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (err) {
      if (err.message.includes('message is not modified')) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '이미 최신 모델 목록입니다.' });
        return;
      }
      throw err;
    }
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error(`[Model Discovery Error] ${error.message}`);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `모델 조회 실패: ${error.message}`,
      show_alert: true
    });
  }
}

/**
 * 모델 선택 완료 안내 화면 (UX 개선)
 */
async function showModelSelectedSuccess(bot, callbackQuery, providerName, modelId) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  const activeSession = SessionManager.getActiveSession(userId);

  const text =
    `✅ **모델 설정이 완료되었습니다.**\n\n` +
    `📌 **세션**: **${activeSession.title}**\n` +
    `🤖 **Provider**: \`${providerName.toUpperCase()}\`\n` +
    `🧠 **Model**: \`${modelId === 'default' ? '기본 모델 (CLI Default)' : modelId}\`\n\n` +
    `_이 세션의 모든 질의는 위 모델로 실행됩니다._`;

  const buttons = [
    [{ text: '🔄 다른 모델로 변경', callback_data: `model_provider:${providerName}` }],
    [{ text: '📁 세션 관리 (/sessions)', callback_data: 'session_tab:ACTIVE' }]
  ];

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    if (!err.message.includes('message is not modified')) {
      throw err;
    }
  }
}

/**
 * Model Callback Query 라우터
 */
export async function handleModelCallback(bot, callbackQuery) {
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;

  if (data === 'model_back_to_providers') {
    await handleModelCommand(bot, callbackQuery);
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith('model_provider:')) {
    const providerName = data.replace('model_provider:', '');
    await showModelsForProvider(bot, callbackQuery, providerName);
    return;
  }

  if (data.startsWith('model_refresh:')) {
    const providerName = data.replace('model_refresh:', '');
    const adapter = providerManager.getAdapter(providerName);
    await adapter.discoverModels(true); // 강제 새로고침
    await showModelsForProvider(bot, callbackQuery, providerName);
    return;
  }

  if (data.startsWith('model_select:')) {
    const parts = data.replace('model_select:', '').split(':');
    const providerName = parts[0];
    const modelId = parts[1];

    const activeSession = SessionManager.getActiveSession(userId);
    const targetModel = modelId === 'default' ? null : modelId;

    try {
      await HandoffManager.executeHandoff({
        sessionId: activeSession.id,
        fromProvider: activeSession.active_provider,
        toProvider: providerName,
        targetModel
      });

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `[${providerName.toUpperCase()} / ${modelId}] 적용 완료!`
      });

      // 선택 완료 화면으로 깔끔하게 전환
      await showModelSelectedSuccess(bot, callbackQuery, providerName, modelId);
    } catch (err) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `변경 실패: ${err.message}`,
        show_alert: true
      });
    }
  }
}
