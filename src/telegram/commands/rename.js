import { SessionManager } from '../../sessions/session-manager.js';
import { isStealthMode, uiStatusIcon } from '../renderer/ui-theme.js';

export async function handleRenameCommand(bot, msg, args) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const newTitle = args.trim();
  if (!newTitle) {
    await bot.sendMessage(chatId, `${isStealthMode() ? '[i]' : 'ℹ️'} **사용법**: \`/rename <새 세션 제목>\`\n예시: \`/rename 백엔드 리팩토링 작업\``, { parse_mode: 'Markdown' });
    return;
  }
  try {
    const activeSession = SessionManager.getActiveSession(userId);
    SessionManager.renameSession(activeSession.id, newTitle);
    const text = isStealthMode()
      ? `${uiStatusIcon('success')} **세션 제목이 변경되었습니다.**\n\n이전: ${activeSession.title}\n**변경됨**: **${newTitle}** [LOCK]`
      : `🏷️ **세션 제목이 변경되었습니다.**\n\n이전: ${activeSession.title}\n**변경됨**: **${newTitle}** 🔒(고정됨)`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /rename Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 세션 이름 변경 실패: ${error.message}`);
  }
}
