import { providerManager } from '../../providers/provider-manager.js';
import { isStealthMode, uiTitle, uiStatusIcon } from '../renderer/ui-theme.js';

/**
 * /providers 명령어 처리: 프로바이더 상태, 인증, 기능 요약 UI
 */
export async function handleProvidersCommand(bot, msg) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;

  try {
    const statuses = await providerManager.getProvidersStatus();
    const stealth = isStealthMode();
    let text = `${uiTitle('🔌', 'Provider 상태 및 정보')}\n\n`;

    for (const st of statuses) {
      const stateIcon = st.healthy ? uiStatusIcon('active') : uiStatusIcon('error');
      text += `${stateIcon} **${st.name.toUpperCase()}**\n`;
      text += `• **상태**: ${st.healthy ? '정상 (Healthy)' : '오류 (Unhealthy)'}\n`;
      text += `• **CLI 버전**: \`${st.version}\`\n`;
      text += `• **인증**: ${st.authenticated ? `${uiStatusIcon('success')} 인증됨` : `${uiStatusIcon('warning')} 인증 필요`}\n`;
      if (st.authDetails) text += `  └ _${st.authDetails}_\n`;

      if (st.capabilities) {
        text += `• **주요 지원 기능**:\n`;
        text += `  - JSON Output: \`${st.capabilities.jsonOutput}\`\n`;
        text += `  - Session Resume: \`${st.capabilities.nativeSessionResume}\`\n`;
        text += `  - Multi Image: \`${st.capabilities.multiImage}\`\n`;
        text += `  - Native Compact: \`${st.capabilities.nativeCompact}\`\n`;
      }
      text += `\n`;
    }

    const buttons = [[{ text: stealth ? '↻ 상태 새로고침' : '🔄 상태 새로고침', callback_data: 'providers_refresh' }]];
    const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };

    if (msg.message_id && !msg.chat) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: msg.message.message_id, ...options });
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    console.error(`[Command /providers Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 프로바이더 상태 조회 실패: ${error.message}`);
  }
}

export async function handleProvidersCallback(bot, callbackQuery) {
  if (callbackQuery.data === 'providers_refresh') {
    await handleProvidersCommand(bot, callbackQuery);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '프로바이더 상태가 갱신되었습니다.' });
  }
}
