import { Compactor } from '../../context/compactor.js';

/**
 * /compact 명령어 처리: 수동 컨텍스트 압축 요청
 */
export async function handleCompactCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const result = await Compactor.compactActiveSession(userId);
    await bot.sendMessage(chatId, result.message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /compact Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 컨텍스트 압축 실패: ${error.message}`);
  }
}
