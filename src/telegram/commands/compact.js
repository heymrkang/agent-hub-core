import { Compactor } from '../../context/compactor.js';
import { isStealthMode, uiStatusIcon } from '../renderer/ui-theme.js';

export async function handleCompactCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  try {
    const result = await Compactor.compactActiveSession(userId);
    const message = isStealthMode()
      ? String(result.message).replace(/[🧠📦✨✅⚡🔄]/gu, '').replace(/^\s+/gm, '')
      : result.message;
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /compact Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 컨텍스트 압축 실패: ${error.message}`);
  }
}
