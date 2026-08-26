import { SessionManager } from '../../sessions/session-manager.js';
import { providerManager } from '../../providers/provider-manager.js';
import { HandoffManager } from '../../context/handoff-manager.js';

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

    const buttons = providers.map((p) => [{
      text: p === activeSession.active_provider ? `🟢 ${p.toUpperCase()} (선택됨)` : `⚪ ${p.toUpperCase()}`,
      callback_data: `model_provider:${p}`
    }]);

    const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

    if (msg.message_id && !msg.chat) {
      try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msg.message.message_id, ...options });
      } catch (err) {
        if (!err.message.includes('message is not modified')) throw err;
      }
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    console.error(`[Command /model Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 모델 설정 실패: ${error.message}`);
  }
}

async function showModelsForProvider(bot, callbackQuery, providerName, forceRefresh = false) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  // Telegram callback query는 오래 기다리면 만료되므로 discovery 전에 즉시 ACK한다.
  await bot.answerCallbackQuery(callbackQuery.id, { text: `${providerName.toUpperCase()} 모델 조회 중...` }).catch(() => {});

  const loadingText =
    `⏳ **[${providerName.toUpperCase()}] 모델 목록 조회 중...**\n\n` +
    `CLI에서 현재 사용 가능한 모델을 확인하고 있습니다.`;

  await bot.editMessageText(loadingText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🔙 Provider 목록으로', callback_data: 'model_back_to_providers' }]] }
  }).catch(() => {});

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const adapter = providerManager.getAdapter(providerName);
    const models = await adapter.discoverModels(forceRefresh);

    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('사용 가능한 모델이 없습니다.');
    }

    let text = `🎛️ **[${providerName.toUpperCase()}] 지원 모델 목록**\n\n`;
    text += `📌 **활성 세션**: **${activeSession.title}**\n`;
    text += `원하는 모델을 선택하면 현재 활성 세션에 적용됩니다:`;

    const buttons = [];
    for (const m of models) {
      const isCurrent = activeSession.active_provider === providerName &&
        (activeSession.active_model === m.id || (!activeSession.active_model && m.id === 'default'));

      buttons.push([{
        text: `${isCurrent ? '🟢 ' : '⚪ '}${m.name}`,
        callback_data: `model_select:${providerName}:${m.id}`
      }]);
    }

    buttons.push([
      { text: '🔄 새로고침', callback_data: `model_refresh:${providerName}` },
      { text: '🔙 Provider 목록으로', callback_data: 'model_back_to_providers' }
    ]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error(`[Model Discovery Error] ${providerName}: ${error.message}`);

    const errorText =
      `❌ **[${providerName.toUpperCase()}] 모델 목록 조회 실패**\n\n` +
      `${error.message}\n\n` +
      `CLI 인증 상태나 \`agy models\` 실행 결과를 확인해주세요.`;

    await bot.editMessageText(errorText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 다시 시도', callback_data: `model_refresh:${providerName}` }],
          [{ text: '🔙 Provider 목록으로', callback_data: 'model_back_to_providers' }]
        ]
      }
    }).catch(async () => {
      await bot.sendMessage(chatId, `❌ ${providerName} 모델 조회 실패: ${error.message}`).catch(() => {});
    });
  }
}

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
    if (!err.message.includes('message is not modified')) throw err;
  }
}

export async function handleModelCallback(bot, callbackQuery) {
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;

  if (data === 'model_back_to_providers') {
    await handleModelCommand(bot, callbackQuery);
    await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    return;
  }

  if (data.startsWith('model_provider:')) {
    const providerName = data.replace('model_provider:', '');
    await showModelsForProvider(bot, callbackQuery, providerName, false);
    return;
  }

  if (data.startsWith('model_refresh:')) {
    const providerName = data.replace('model_refresh:', '');
    await showModelsForProvider(bot, callbackQuery, providerName, true);
    return;
  }

  if (data.startsWith('model_select:')) {
    const parts = data.replace('model_select:', '').split(':');
    const providerName = parts[0];
    const modelId = parts.slice(1).join(':');
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
      }).catch(() => {});

      await showModelSelectedSuccess(bot, callbackQuery, providerName, modelId);
    } catch (err) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `변경 실패: ${err.message}`,
        show_alert: true
      }).catch(() => {});
      await bot.sendMessage(callbackQuery.message.chat.id, `❌ 모델 변경 실패: ${err.message}`).catch(() => {});
    }
  }
}
